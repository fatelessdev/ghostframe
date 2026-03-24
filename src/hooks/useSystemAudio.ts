import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useApp } from "@/contexts";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import {
  fetchAIResponse,
  getElevenLabsRealtimeConfig,
  getSystemAudioInterviewSettings,
  updateSystemAudioInterviewSettings,
  safeLocalStorage,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
  tauriCommands,
  tauriEvents,
} from "@/lib";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
import {
  type SystemAudioInterviewSettings,
  type TranscriptSegment,
  type TranscriptSource,
} from "@/types";
import { normalizeTranscription } from "@/lib/utils";
import {
  commitSegment,
  mergeTranscriptForPrompt,
  replaceLatestCommittedSegment,
  replaceLiveSegment,
  retainUnsentSegments,
} from "@/hooks/internal/systemAudioUtils";
import {
  closeRealtimeHandle as closeRealtimeHandleInternal,
  createRealtimeHandle,
  sendRealtimeChunk as sendRealtimeChunkInternal,
  type RealtimeHandle,
} from "@/hooks/internal/systemAudioRealtime";
import {
  MIC_SAMPLE_RATE,
  startMicCapture as startMicCaptureInternal,
  stopMicCapture as stopMicCaptureInternal,
  type MicCaptureRefs,
} from "@/hooks/internal/systemAudioMic";
import {
  restartSystemAudioCaptureWithRetry,
  waitForCaptureState,
} from "@/hooks/internal/systemAudioCapture";
import { connectSystemAudioRealtime } from "@/hooks/internal/systemAudioConnection";
import {
  appendManualScreenshot,
  buildImagesPayload as buildImagesPayloadInternal,
  clearManualScreenshotsState,
  createManualScreenshot,
  getCacheAgeLabel,
  type ManualScreenshot,
} from "@/hooks/internal/systemAudioScreenshots";
import {
  commitLatestPartialTranscripts,
  commitRealtimeStreamsForAnswerTrigger,
  type PendingCommitEcho,
} from "@/hooks/internal/systemAudioAnswerTrigger";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
};

type ChatConversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

type CaptureTrigger = "manual" | "shortcut" | "setup";

const SYSTEM_AUDIO_SCREENSHOT_INTERVAL_MS = 2000;
const PENDING_COMMIT_ECHO_TTL_MS = 5000;
const REALTIME_MAX_CONNECT_ATTEMPTS = 3;
const REALTIME_RETRY_DELAY_MS = 900;
const REALTIME_KEEPALIVE_INTERVAL_MS = 4000;
const REALTIME_KEEPALIVE_MS_OF_SILENCE = 120;
const REALTIME_BOOTSTRAP_MS_OF_SILENCE = 60;
const REALTIME_MIN_COMMIT_AUDIO_MS = 320;
const REALTIME_QUEUE_LIMIT = 50;
const SYSTEM_AUDIO_START_RETRY_LIMIT = 3;
const SYSTEM_AUDIO_START_RETRY_DELAY_MS = 350;
const SYSTEM_AUDIO_CAPTURE_STATUS_TIMEOUT_MS = 2500;
const SYSTEM_AUDIO_CAPTURE_STATUS_POLL_MS = 125;

const initialConversation = (): ChatConversation => ({
  id: generateConversationId("sysaudio"),
  title: "",
  messages: [],
  createdAt: 0,
  updatedAt: 0,
});

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const globalShortcuts = useGlobalShortcuts();
  const {
    registerAnswerTriggerCallback,
    registerScreenshotCallback,
    registerSystemAudioCallback,
    unregisterScreenshotCallback,
  } = globalShortcuts;
  const {
    selectedSttProvider,
    selectedAIProvider,
    allAiProviders,
    currentAIMode,
    systemPrompt,
    selectedAudioDevices,
  } = useApp();

  const [settings, setSettings] = useState<SystemAudioInterviewSettings>(() =>
    getSystemAudioInterviewSettings()
  );
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [error, setError] = useState("");
  const [lastAIResponse, setLastAIResponse] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [manualScreenshots, setManualScreenshots] = useState<ManualScreenshot[]>(
    []
  );
  const [cachedScreenshotPreview, setCachedScreenshotPreview] = useState<
    string | null
  >(null);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<number | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);

  const [conversation, setConversation] = useState<ChatConversation>(
    initialConversation
  );

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const captureAbortControllerRef = useRef<AbortController | null>(null);
  const startCaptureInFlightRef = useRef(false);
  const stopCaptureInFlightRef = useRef(false);
  const lastSystemAudioToggleAtRef = useRef(0);
  const realtimeConnectionSeqRef = useRef(0);
  const answerTriggerInFlightRef = useRef(false);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const latestPartialInterviewerRef = useRef<string>("");
  const latestPartialUserRef = useRef<string>("");
  const pendingCommitEchoRef = useRef<
    Partial<Record<TranscriptSource, PendingCommitEcho>>
  >({});

  const cachedScreenshotRef = useRef<string | null>(null);
  const periodicScreenshotIntervalRef = useRef<number | null>(null);
  const periodicScreenshotInFlightRef = useRef(false);
  const manualScreenshotsRef = useRef<ManualScreenshot[]>([]);

  const interviewerRealtimeRef = useRef<RealtimeHandle>(
    createRealtimeHandle("interviewer")
  );

  const userRealtimeRef = useRef<RealtimeHandle>(createRealtimeHandle("user"));

  const micMediaStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPreBufferRef = useRef<string[]>([]);
  const micFrameBufferRef = useRef<Float32Array>(new Float32Array(0));
  const userSpeechLikelyRef = useRef(false);

  const liveTranscript = useMemo(() => {
    return segments.slice().sort((a, b) => a.timestamp - b.timestamp);
  }, [segments]);

  const lastCommittedPrompt = useMemo(() => {
    return mergeTranscriptForPrompt(segments);
  }, [segments]);

  const quickActions = settings.quickActions;
  const useSystemPrompt = settings.useSystemPrompt;
  const contextContent = settings.contextContent;
  const vadConfig = settings.vadConfig;
  const maxManualScreenshots = settings.maxManualScreenshots;

  const updateSettings = useCallback(
    (updates: Partial<SystemAudioInterviewSettings>) => {
      const next = updateSystemAudioInterviewSettings(updates);
      setSettings(next);
      return next;
    },
    []
  );

  const setUseSystemPrompt = useCallback(
    (value: boolean) => {
      updateSettings({ useSystemPrompt: value });
    },
    [updateSettings]
  );

  const setContextContent = useCallback(
    (value: string) => {
      updateSettings({ contextContent: value });
    },
    [updateSettings]
  );

  const addQuickAction = useCallback(
    (action: string) => {
      const value = action.trim();
      if (!value || settings.quickActions.includes(value)) {
        return;
      }
      updateSettings({ quickActions: [...settings.quickActions, value] });
    },
    [settings.quickActions, updateSettings]
  );

  const removeQuickAction = useCallback(
    (action: string) => {
      updateSettings({
        quickActions: settings.quickActions.filter((item) => item !== action),
      });
    },
    [settings.quickActions, updateSettings]
  );

  const updateVadConfiguration = useCallback(
    async (config: SystemAudioInterviewSettings["vadConfig"]) => {
      updateSettings({ vadConfig: config });
      safeLocalStorage.setItem("vad_config", JSON.stringify(config));
      try {
        await tauriCommands.updateVadConfig(config);
      } catch (updateError) {
        console.warn("Failed to sync VAD config with backend:", updateError);
      }
    },
    [updateSettings]
  );

  const updateMaxManualScreenshots = useCallback(
    (value: number) => {
      const next = Math.max(1, Math.min(8, Math.round(value)));
      updateSettings({ maxManualScreenshots: next });
      setManualScreenshots((previous) => {
        const trimmed = previous.slice(-next);
        manualScreenshotsRef.current = trimmed;
        return trimmed;
      });
    },
    [updateSettings]
  );

  const getEffectiveSystemPrompt = useCallback(() => {
    if (useSystemPrompt) {
      return systemPrompt || DEFAULT_SYSTEM_PROMPT;
    }
    return contextContent.trim() || DEFAULT_SYSTEM_PROMPT;
  }, [contextContent, systemPrompt, useSystemPrompt]);

  const getPreviousMessages = useCallback(() => {
    return conversation.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }, [conversation.messages]);

  useEffect(() => {
    captureRef.current = capturing;
  }, [capturing]);

  const applySegmentUpdate = useCallback(
    (updater: (current: TranscriptSegment[]) => TranscriptSegment[]) => {
      const next = updater(segmentsRef.current);
      segmentsRef.current = next;
      setSegments(next);
      return next;
    },
    []
  );

  const clearPendingRealtimeState = useCallback(() => {
    latestPartialInterviewerRef.current = "";
    latestPartialUserRef.current = "";
    pendingCommitEchoRef.current = {};
  }, []);

  const resetInterviewState = useCallback(() => {
    applySegmentUpdate(() => []);
    clearPendingRealtimeState();
  }, [applySegmentUpdate, clearPendingRealtimeState]);

  const appendLiveTranscript = useCallback(
    (source: TranscriptSource, text: string) => {
      applySegmentUpdate((previous) => replaceLiveSegment(previous, source, text));
    },
    [applySegmentUpdate]
  );

  const appendCommittedTranscript = useCallback(
    (source: TranscriptSource, text: string) => {
      applySegmentUpdate((previous) => commitSegment(previous, source, text));
    },
    [applySegmentUpdate]
  );

  const commitLiveSegmentOnSpeakerSwitch = useCallback(
    (activeSource: TranscriptSource) => {
      const interruptedSource: TranscriptSource =
        activeSource === "interviewer" ? "user" : "interviewer";
      const interruptedText =
        interruptedSource === "interviewer"
          ? latestPartialInterviewerRef.current.trim()
          : latestPartialUserRef.current.trim();

      if (!interruptedText) {
        return;
      }

      appendCommittedTranscript(interruptedSource, interruptedText);
      pendingCommitEchoRef.current[interruptedSource] = {
        partialText: interruptedText,
        timestamp: Date.now(),
      };

      if (interruptedSource === "interviewer") {
        latestPartialInterviewerRef.current = "";
      } else {
        latestPartialUserRef.current = "";
      }
    },
    [appendCommittedTranscript]
  );

  const closeRealtimeConnection = useCallback(
    (
      handle: RealtimeHandle,
      options?: { preserveReconnect?: boolean; reason?: string }
    ) => {
      closeRealtimeHandleInternal(handle, {
        ...options,
        onClosing: (message) => {
          console.info(message);
        },
        onCloseError: (error) => {
          console.warn("Failed to close realtime connection:", error);
        },
      });
    },
    []
  );

  const pushRealtimeChunk = useCallback(
    (handle: RealtimeHandle, chunk: { sample_rate: number; audio_base64: string }) => {
      sendRealtimeChunkInternal(handle, chunk, REALTIME_QUEUE_LIMIT);
    },
    []
  );

  const micRefs = useMemo<MicCaptureRefs>(
    () => ({
      micMediaStreamRef,
      micAudioContextRef,
      micProcessorRef,
      micSourceNodeRef,
      micPreBufferRef,
      micFrameBufferRef,
      userSpeechLikelyRef,
    }),
    []
  );

  const stopMicCapture = useCallback(() => {
    stopMicCaptureInternal(micRefs);
  }, [micRefs]);

  const schedulePeriodicScreenshotCapture = useCallback(() => {
    if (periodicScreenshotIntervalRef.current !== null) {
      return;
    }

    periodicScreenshotIntervalRef.current = window.setInterval(async () => {
      if (!captureRef.current || periodicScreenshotInFlightRef.current) {
        return;
      }

      periodicScreenshotInFlightRef.current = true;
      try {
        const base64 = await tauriCommands.captureToBase64();
        cachedScreenshotRef.current = base64;
        setCachedScreenshotPreview(base64);
        setCacheUpdatedAt(Date.now());
      } catch (captureError) {
        console.warn("Periodic screenshot capture failed:", captureError);
      } finally {
        periodicScreenshotInFlightRef.current = false;
      }
    }, SYSTEM_AUDIO_SCREENSHOT_INTERVAL_MS);
  }, []);

  const stopPeriodicScreenshotCapture = useCallback(() => {
    if (periodicScreenshotIntervalRef.current !== null) {
      window.clearInterval(periodicScreenshotIntervalRef.current);
      periodicScreenshotIntervalRef.current = null;
    }
  }, []);

  const waitForBackendCaptureState = useCallback(
    async (expected: boolean): Promise<boolean> => {
      return waitForCaptureState({
        expected,
        timeoutMs: SYSTEM_AUDIO_CAPTURE_STATUS_TIMEOUT_MS,
        pollMs: SYSTEM_AUDIO_CAPTURE_STATUS_POLL_MS,
        getCaptureStatus: () => tauriCommands.getCaptureStatus(),
        onStatusError: (statusError) => {
          console.warn("[SystemAudio] failed to read capture status:", statusError);
        },
      });
    },
    []
  );

  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) {
      return;
    }

    setIsCapturingScreenshot(true);
    try {
      const base64 = await tauriCommands.captureToBase64();
      const manual: ManualScreenshot = createManualScreenshot(base64);

      setManualScreenshots((previous) => {
        const next = appendManualScreenshot(previous, manual, maxManualScreenshots);
        manualScreenshotsRef.current = next;
        return next;
      });
    } catch (captureError) {
      console.error("Manual screenshot capture failed:", captureError);
      setError("Failed to capture screenshot");
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [isCapturingScreenshot, maxManualScreenshots]);

  const removeManualScreenshot = useCallback((id: string) => {
    setManualScreenshots((previous) => {
      const next = previous.filter((item) => item.id !== id);
      manualScreenshotsRef.current = next;
      return next;
    });
  }, []);

  const buildImagesPayload = useCallback((): string[] => {
    return buildImagesPayloadInternal(
      cachedScreenshotRef.current,
      manualScreenshotsRef.current
    );
  }, []);

  const saveConversationDebounced = useCallback(
    (nextConversation: ChatConversation) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      if (
        !nextConversation.id ||
        nextConversation.updatedAt === 0 ||
        nextConversation.messages.length === 0
      ) {
        return;
      }

      saveTimeoutRef.current = setTimeout(async () => {
        if (isSavingRef.current) {
          return;
        }

        try {
          isSavingRef.current = true;
          await saveConversation(nextConversation);
        } catch (saveError) {
          console.error("Failed to save system audio conversation:", saveError);
        } finally {
          isSavingRef.current = false;
        }
      }, CONVERSATION_SAVE_DEBOUNCE_MS);
    },
    []
  );

  useEffect(() => {
    saveConversationDebounced(conversation);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [conversation, saveConversationDebounced]);

  const runAI = useCallback(
    async (userMessage: string, imagesBase64: string[]): Promise<boolean> => {
      if (!selectedAIProvider.provider) {
        setError("No AI provider selected.");
        return false;
      }

      const provider = allAiProviders.find(
        (entry) => entry.id === selectedAIProvider.provider
      );
      if (!provider) {
        setError("AI provider config not found.");
        return false;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsAIProcessing(true);
      setIsProcessing(false);
      setError("");
      setLastAIResponse("");

      const timestamp = Date.now();
      const previousMessages = getPreviousMessages();
      const fullPrompt = userMessage.trim();

      if (!fullPrompt) {
        setIsAIProcessing(false);
        return false;
      }

      const userChatMessage: ChatMessage = {
        id: generateMessageId("user", timestamp),
        role: "user",
        content: fullPrompt,
        timestamp,
      };

      setConversation((previous) => {
        const nextMessages = [userChatMessage, ...previous.messages];
        return {
          ...previous,
          messages: nextMessages,
          updatedAt: timestamp,
          createdAt: previous.createdAt || timestamp,
          title: previous.title || generateConversationTitle(fullPrompt),
        };
      });

      let fullResponse = "";
      try {
        for await (const chunk of fetchAIResponse({
          provider,
          selectedProvider: selectedAIProvider,
          systemPrompt: getEffectiveSystemPrompt(),
          history: previousMessages,
          userMessage: fullPrompt,
          imagesBase64,
          aiMode: currentAIMode,
          signal: controller.signal,
        })) {
          fullResponse += chunk;
          setLastAIResponse((previous) => previous + chunk);
        }

        if (fullResponse.trim()) {
          const assistantMessage: ChatMessage = {
            id: generateMessageId("assistant", timestamp + 1),
            role: "assistant",
            content: fullResponse,
            timestamp: timestamp + 1,
          };

          setConversation((previous) => ({
            ...previous,
            messages: [assistantMessage, ...previous.messages],
            updatedAt: Date.now(),
          }));
        }

        setManualScreenshots((previous) => {
          return clearManualScreenshotsState(previous, manualScreenshotsRef);
        });
        return true;
      } catch (aiError) {
        if (!controller.signal.aborted) {
          setError(
            aiError instanceof Error
              ? aiError.message
              : "Failed to generate AI response"
          );
        }
        return false;
      } finally {
        setIsAIProcessing(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      allAiProviders,
      currentAIMode,
      getEffectiveSystemPrompt,
      getPreviousMessages,
      selectedAIProvider,
    ]
  );

  const processPendingAnswer = useCallback(async () => {
    if (!capturing || answerTriggerInFlightRef.current) {
      return;
    }

    answerTriggerInFlightRef.current = true;
    setIsProcessing(true);
    setError("");

    try {
      const triggerTs = Date.now();
      const mergedPrompt = mergeTranscriptForPrompt(segmentsRef.current, triggerTs);
      const prompt = mergedPrompt.trim();

      if (!prompt) {
        setIsProcessing(false);
        setError("No transcript available yet. Keep speaking and try again.");
        return;
      }

      const imagesBase64 = buildImagesPayload();
      const sent = await runAI(prompt, imagesBase64);
      if (sent) {
        applySegmentUpdate((previous) => retainUnsentSegments(previous, triggerTs));
        clearPendingRealtimeState();
      }
    } finally {
      answerTriggerInFlightRef.current = false;
      setIsProcessing(false);
    }
  }, [
    applySegmentUpdate,
    buildImagesPayload,
    capturing,
    clearPendingRealtimeState,
    runAI,
  ]);

  const closeRealtimeSystems = useCallback(
    (reason: string) => {
      closeRealtimeConnection(interviewerRealtimeRef.current, { reason });
      closeRealtimeConnection(userRealtimeRef.current, { reason });
      stopMicCapture();
    },
    [closeRealtimeConnection, stopMicCapture]
  );

  const startMicCapture = useCallback(async () => {
    await startMicCaptureInternal({
      selectedInputId: selectedAudioDevices.input.id,
      captureRef,
      refs: micRefs,
      sendChunk: (chunk) => {
        pushRealtimeChunk(userRealtimeRef.current, chunk);
      },
    });
  }, [micRefs, pushRealtimeChunk, selectedAudioDevices.input.id]);

  const connectRealtime = useCallback(
    async (
      handle: RealtimeHandle,
      source: TranscriptSource,
      sampleRate: number,
      signal: AbortSignal
    ) => {
      const realtimeConfig = getElevenLabsRealtimeConfig(selectedSttProvider);

      await connectSystemAudioRealtime({
        handle,
        source,
        sampleRate,
        signal,
        realtimeConfig,
        maxConnectAttempts: REALTIME_MAX_CONNECT_ATTEMPTS,
        retryDelayMs: REALTIME_RETRY_DELAY_MS,
        keepAliveIntervalMs: REALTIME_KEEPALIVE_INTERVAL_MS,
        keepAliveSilenceMs: REALTIME_KEEPALIVE_MS_OF_SILENCE,
        bootstrapSilenceMs: REALTIME_BOOTSTRAP_MS_OF_SILENCE,
        getNextConnectionId: () => ++realtimeConnectionSeqRef.current,
        closeRealtime: closeRealtimeConnection,
        onReady: () => {
          setError("");
        },
        onPartialTranscript: (rawText) => {
          const text = normalizeTranscription(rawText).trim();
          if (!text) {
            return;
          }

          commitLiveSegmentOnSpeakerSwitch(source);
          setError("");

          if (source === "interviewer") {
            latestPartialInterviewerRef.current = text;
          } else {
            latestPartialUserRef.current = text;
          }

          appendLiveTranscript(source, text);
        },
        onCommittedTranscript: (rawText) => {
          const text = normalizeTranscription(rawText).trim();
          if (!text) {
            return;
          }

          setError("");
          const pending = pendingCommitEchoRef.current[source];
          if (pending) {
            const age = Date.now() - pending.timestamp;
            if (age > PENDING_COMMIT_ECHO_TTL_MS) {
              pendingCommitEchoRef.current[source] = undefined;
              return;
            }

            if (pending.partialText === text) {
              pendingCommitEchoRef.current[source] = undefined;
              return;
            }

            const replaced = replaceLatestCommittedSegment(
              segmentsRef.current,
              source,
              pending.partialText,
              text
            );
            if (replaced) {
              applySegmentUpdate(() => replaced);
            }
            pendingCommitEchoRef.current[source] = undefined;
            return;
          }

          appendCommittedTranscript(source, text);
        },
        onRealtimeError: (message, event) => {
          if (event) {
            console.error(`ElevenLabs ${source} realtime error:`, event);
          }
          setError(message || "Realtime transcription failed.");
        },
        onInfo: (message) => {
          console.info(message);
        },
        onWarn: (message) => {
          console.warn(message);
        },
        onReconnectError: (error) => {
          console.error(`Failed to reconnect ${source} realtime:`, error);
        },
      });
    },
    [
      applySegmentUpdate,
      appendCommittedTranscript,
      appendLiveTranscript,
      commitLiveSegmentOnSpeakerSwitch,
      closeRealtimeConnection,
      selectedSttProvider,
    ]
  );

  const startCapture = useCallback(async (trigger: CaptureTrigger = "manual") => {
    if (startCaptureInFlightRef.current) {
      return;
    }

    if (stopCaptureInFlightRef.current) {
      console.info(`[SystemAudio] start ignored (${trigger}); stop in flight`);
      return;
    }

    if (captureRef.current) {
      console.info(`[SystemAudio] start ignored (${trigger}); already capturing`);
      return;
    }

    startCaptureInFlightRef.current = true;
    let startPhase = "init";
    let controller: AbortController | null = null;

    try {
      console.info(`[SystemAudio] start begin (${trigger})`);
      setError("");

      startPhase = "check_system_audio_access";
      const hasAccess = await tauriCommands.checkSystemAudioAccess();
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      if (captureAbortControllerRef.current) {
        captureAbortControllerRef.current.abort();
      }
      controller = new AbortController();
      captureAbortControllerRef.current = controller;
      const signal = controller.signal;

      startPhase = "get_audio_sample_rate";
      const deviceId =
        selectedAudioDevices.output.id && selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      const sampleRate = await tauriCommands.getAudioSampleRate(deviceId);

      setConversation(initialConversation());
      resetInterviewState();
      setLastAIResponse("");
      setManualScreenshots((previous) => {
        return clearManualScreenshotsState(previous, manualScreenshotsRef);
      });
      setSetupRequired(false);
      setIsPopoverOpen(true);
      setCapturing(true);
      captureRef.current = true;

      interviewerRealtimeRef.current.shouldReconnect = true;
      userRealtimeRef.current.shouldReconnect = true;

      startPhase = "start_mic_capture";
      await startMicCapture();

      startPhase = "connect_interviewer_realtime";
      await connectRealtime(interviewerRealtimeRef.current, "interviewer", sampleRate, signal);
      startPhase = "connect_user_realtime";
      await connectRealtime(userRealtimeRef.current, "user", MIC_SAMPLE_RATE, signal);
      schedulePeriodicScreenshotCapture();

      startPhase = "restart_system_audio_capture";
      await restartSystemAudioCaptureWithRetry({
        startCapture: (args) => tauriCommands.startSystemAudioCapture(args),
        stopCapture: () => tauriCommands.stopSystemAudioCapture(),
        waitForState: waitForBackendCaptureState,
        vadConfig,
        deviceId,
        retryLimit: SYSTEM_AUDIO_START_RETRY_LIMIT,
        retryDelayMs: SYSTEM_AUDIO_START_RETRY_DELAY_MS,
        onAttemptFailure: (attempt, retryLimit, message) => {
          console.warn(
            `[SystemAudio] start_system_audio_capture attempt ${attempt}/${retryLimit} failed: ${message}`
          );
        },
      });
    } catch (startError) {
      console.error(
        `[SystemAudio] start failed at phase: ${startPhase}`,
        startError
      );
      closeRealtimeSystems(`start_failed:${startPhase}`);
      stopPeriodicScreenshotCapture();
      setCapturing(false);
      captureRef.current = false;
      if (captureAbortControllerRef.current === controller) {
        captureAbortControllerRef.current = null;
      }
      setIsPopoverOpen(true);
      setError(
        startError instanceof Error
          ? startError.message
          : "Failed to start system audio capture"
      );
    } finally {
      startCaptureInFlightRef.current = false;
    }
  }, [
    closeRealtimeSystems,
    connectRealtime,
    resetInterviewState,
    schedulePeriodicScreenshotCapture,
    selectedAudioDevices.output.id,
    startMicCapture,
    stopPeriodicScreenshotCapture,
    vadConfig,
    waitForBackendCaptureState,
  ]);

  const stopCapture = useCallback(async (trigger: CaptureTrigger = "manual") => {
    if (stopCaptureInFlightRef.current) {
      return;
    }

    stopCaptureInFlightRef.current = true;

    try {
      if (!captureRef.current && !startCaptureInFlightRef.current) {
        return;
      }

      console.info(`[SystemAudio] stop begin (${trigger})`);

      if (captureAbortControllerRef.current) {
        captureAbortControllerRef.current.abort();
        captureAbortControllerRef.current = null;
      }

      closeRealtimeSystems(`stop_capture:${trigger}`);
      stopPeriodicScreenshotCapture();

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      await tauriCommands.stopSystemAudioCapture();
      await waitForBackendCaptureState(false);

      setCapturing(false);
      captureRef.current = false;
      setIsProcessing(false);
      setIsAIProcessing(false);
      setIsPopoverOpen(false);
      setError("");
      setCacheUpdatedAt(null);
      setCachedScreenshotPreview(null);
      cachedScreenshotRef.current = null;
      resetInterviewState();
    } catch (stopError) {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "Failed to stop capture"
      );
    } finally {
      stopCaptureInFlightRef.current = false;
    }
  }, [
    closeRealtimeSystems,
    resetInterviewState,
    stopPeriodicScreenshotCapture,
    waitForBackendCaptureState,
  ]);

  const commitBothStreams = useCallback(() => {
    commitRealtimeStreamsForAnswerTrigger({
      interviewerHandle: interviewerRealtimeRef.current,
      userHandle: userRealtimeRef.current,
      minCommitAudioMs: REALTIME_MIN_COMMIT_AUDIO_MS,
      latestPartialInterviewerRef,
      latestPartialUserRef,
      pendingCommitEchoRef,
      onCommitError: (source, error) => {
        console.warn(`[SystemAudio][${source}] failed to commit stream:`, error);
      },
    });
  }, []);

  const onAnswerTrigger = useCallback(async () => {
    if (!capturing) {
      return;
    }

    commitBothStreams();
    commitLatestPartialTranscripts({
      latestPartialInterviewerRef,
      latestPartialUserRef,
      pendingCommitEchoRef,
      appendCommittedTranscript,
    });

    await processPendingAnswer();
  }, [
    appendCommittedTranscript,
    capturing,
    commitBothStreams,
    processPendingAnswer,
  ]);

  useEffect(() => {
    const globalWindow = window as Window & {
      __ghostframeSystemAudioCapturing?: boolean;
    };

    globalWindow.__ghostframeSystemAudioCapturing = capturing;
    window.dispatchEvent(
      new CustomEvent("systemAudioCaptureStateChanged", {
        detail: { capturing },
      })
    );
  }, [capturing]);

  useEffect(() => {
    if (capturing) {
      registerScreenshotCallback(async () => {
        if (!captureRef.current) {
          return;
        }
        await handleCaptureScreenshot();
      });
      return;
    }

    unregisterScreenshotCallback();
  }, [
    capturing,
    handleCaptureScreenshot,
    registerScreenshotCallback,
    unregisterScreenshotCallback,
  ]);

  const handleQuickActionClick = useCallback(
    async (action: string) => {
      const transcriptText = mergeTranscriptForPrompt(segmentsRef.current);
      const composed = transcriptText
        ? `${transcriptText}\n\nInstruction: ${action}`
        : action;
      await runAI(composed, buildImagesPayload());
    },
    [buildImagesPayload, runAI]
  );

  useEffect(() => {
    registerSystemAudioCallback(async () => {
      const now = Date.now();
      if (now - lastSystemAudioToggleAtRef.current < 900) {
        console.info("[SystemAudio] ignored duplicate system-audio toggle");
        return;
      }
      lastSystemAudioToggleAtRef.current = now;

      if (startCaptureInFlightRef.current || stopCaptureInFlightRef.current) {
        console.info("[SystemAudio] ignored toggle while transition in flight");
        return;
      }

      console.info(
        `[SystemAudio] shortcut toggle requested; capturing=${captureRef.current}`
      );

      if (captureRef.current) {
        await stopCapture("shortcut");
      } else {
        await startCapture("shortcut");
      }
    });

    registerAnswerTriggerCallback(async () => {
      await onAnswerTrigger();
    });
  }, [
    onAnswerTrigger,
    registerAnswerTriggerCallback,
    registerSystemAudioCallback,
    startCapture,
    stopCapture,
  ]);

  useEffect(() => {
    let unlistenRealtimeChunk: (() => void) | undefined;

    const setup = async () => {
      unlistenRealtimeChunk = await tauriEvents.onSpeechRealtimeChunk((event) => {
        if (!captureRef.current) {
          return;
        }

        try {
          pushRealtimeChunk(interviewerRealtimeRef.current, event);
        } catch (chunkError) {
          console.error("Failed to send system audio realtime chunk:", chunkError);
          setError("Failed to stream system audio to realtime transcription.");
        }
      });
    };

    void setup();

    return () => {
      if (unlistenRealtimeChunk) {
        unlistenRealtimeChunk();
      }
    };
  }, [pushRealtimeChunk]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing || setupRequired || !!error || isAIProcessing || !!lastAIResponse;
    setIsPopoverOpen(shouldOpenPopover);
  }, [capturing, setupRequired, error, isAIProcessing, lastAIResponse]);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<SystemAudioInterviewSettings>;
      if (!customEvent.detail) {
        return;
      }
      setSettings(customEvent.detail);
    };

    window.addEventListener("systemAudioInterviewSettingsChanged", onSettingsChanged);

    return () => {
      window.removeEventListener(
        "systemAudioInterviewSettingsChanged",
        onSettingsChanged
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      const globalWindow = window as Window & {
        __ghostframeSystemAudioCapturing?: boolean;
      };
      globalWindow.__ghostframeSystemAudioCapturing = false;
      window.dispatchEvent(
        new CustomEvent("systemAudioCaptureStateChanged", {
          detail: { capturing: false },
        })
      );
      unregisterScreenshotCallback();
      closeRealtimeSystems("unmount");
      stopPeriodicScreenshotCapture();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      void tauriCommands.stopSystemAudioCapture().catch(() => {
        // no-op
      });
    };
  }, [
    closeRealtimeSystems,
    stopPeriodicScreenshotCapture,
    unregisterScreenshotCallback,
  ]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac") || platform.includes("win")) {
        await tauriCommands.requestSystemAudioAccess();
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const hasAccess = await tauriCommands.checkSystemAudioAccess();
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture("setup");
      } else {
        setSetupRequired(true);
        setError("Permission not granted. Please follow the setup steps.");
      }
    } catch {
      setSetupRequired(true);
      setError("Failed to request permission.");
    }
  }, [startCapture]);

  const startNewConversation = useCallback(() => {
    setConversation(initialConversation());
    resetInterviewState();
    setLastAIResponse("");
    setError("");
    setSetupRequired(false);
    setIsProcessing(false);
    setIsAIProcessing(false);
    setManualScreenshots((previous) => {
      return clearManualScreenshotsState(previous, manualScreenshotsRef);
    });
  }, [resetInterviewState]);

  const cacheAgeLabel = useMemo(() => {
    return getCacheAgeLabel(cacheUpdatedAt);
  }, [cacheUpdatedAt]);

  return {
    capturing,
    isProcessing,
    isAIProcessing,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    handleSetup,
    isPopoverOpen,
    setIsPopoverOpen,
    conversation,
    setConversation,
    processWithAI: runAI,
    useSystemPrompt,
    setUseSystemPrompt,
    contextContent,
    setContextContent,
    startNewConversation,
    quickActions,
    addQuickAction,
    removeQuickAction,
    handleQuickActionClick,
    vadConfig,
    updateVadConfiguration,
    lastAIResponse,
    lastTranscription: lastCommittedPrompt,
    transcriptSegments: liveTranscript,
    manualScreenshots,
    removeManualScreenshot,
    cachedScreenshotPreview,
    cacheAgeLabel,
    isCapturingScreenshot,
    handleCaptureScreenshot,
    onAnswerTrigger,
    scrollAreaRef,
    maxManualScreenshots,
    updateMaxManualScreenshots,
    screenshotIntervalMs: SYSTEM_AUDIO_SCREENSHOT_INTERVAL_MS,
  };
}
