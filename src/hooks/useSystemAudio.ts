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
  type SystemAudioLatencyMetric,
  type SystemAudioLatencySnapshot,
  type SystemAudioLatencyStage,
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
const REALTIME_ERROR_THROTTLE_MS = 900;
const REALTIME_DROP_WARNING_COOLDOWN_MS = 2000;
const MAX_AI_RESPONSE_BUFFER_CHARS = 12_000;
const MAX_HISTORY_MESSAGES = 24;
const MAX_HISTORY_CHARS = 18_000;
const LATENCY_SAMPLES_LIMIT = 30;

const initialConversation = (): ChatConversation => ({
  id: generateConversationId("sysaudio"),
  title: "",
  messages: [],
  createdAt: 0,
  updatedAt: 0,
});

const createEmptyLatencyMetric = (): SystemAudioLatencyMetric => ({
  latest: null,
  p50: null,
  p95: null,
  p99: null,
});

const initialLatencySnapshot = (): SystemAudioLatencySnapshot => ({
  startedAt: 0,
  sampleCount: 0,
  answerTriggerToPromptMs: createEmptyLatencyMetric(),
  answerTriggerToFirstChunkMs: createEmptyLatencyMetric(),
  answerTriggerToDoneMs: createEmptyLatencyMetric(),
  promptToFirstChunkMs: createEmptyLatencyMetric(),
  firstChunkToDoneMs: createEmptyLatencyMetric(),
});

const createEmptyLatencySamples = (): Record<string, number[]> => ({
  answerTriggerToPromptMs: [],
  answerTriggerToFirstChunkMs: [],
  answerTriggerToDoneMs: [],
  promptToFirstChunkMs: [],
  firstChunkToDoneMs: [],
});

const computePercentile = (values: number[], percentile: number): number | null => {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((percentile / 100) * (sorted.length - 1)))
  );

  return sorted[index] ?? null;
};

const buildLatencyMetric = (values: number[]): SystemAudioLatencyMetric => {
  if (values.length === 0) {
    return createEmptyLatencyMetric();
  }

  return {
    latest: values[values.length - 1] ?? null,
    p50: computePercentile(values, 50),
    p95: computePercentile(values, 95),
    p99: computePercentile(values, 99),
  };
};

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
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [latencySnapshot, setLatencySnapshot] = useState<SystemAudioLatencySnapshot>(
    initialLatencySnapshot
  );

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
  const lastRealtimeErrorAtRef = useRef<number>(0);
  const lastDroppedQueueWarningAtRef = useRef<Partial<Record<TranscriptSource, number>>>(
    {}
  );
  const answerTriggerInFlightRef = useRef(false);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const transcriptFlushFrameRef = useRef<number | null>(null);
  const latestPartialInterviewerRef = useRef<string>("");
  const latestPartialUserRef = useRef<string>("");
  const pendingCommitEchoRef = useRef<
    Partial<Record<TranscriptSource, PendingCommitEcho>>
  >({});
  const aiResponseFlushFrameRef = useRef<number | null>(null);
  const aiResponseBufferRef = useRef("");
  const pipelineBusyRef = useRef(false);
  const latencyEventsRef = useRef<Partial<Record<SystemAudioLatencyStage, number>>>({});
  const latencySamplesRef = useRef<Record<string, number[]>>(
    createEmptyLatencySamples()
  );

  const manualScreenshotsRef = useRef<ManualScreenshot[]>([]);

  const interviewerRealtimeRef = useRef<RealtimeHandle>(
    createRealtimeHandle("interviewer")
  );

  const userRealtimeRef = useRef<RealtimeHandle>(createRealtimeHandle("user"));

  const micMediaStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPreBufferRef = useRef<string[]>([]);
  const micFrameBufferRef = useRef<Float32Array>(new Float32Array(0));
  const userSpeechLikelyRef = useRef(false);

  const liveTranscript = segments;

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
    const compactHistory: { role: ChatMessage["role"]; content: string }[] = [];
    let usedChars = 0;

    for (const message of conversation.messages.slice(0, MAX_HISTORY_MESSAGES)) {
      const content = message.content.trim();
      if (!content) {
        continue;
      }

      const nextChars = usedChars + content.length;
      if (compactHistory.length > 0 && nextChars > MAX_HISTORY_CHARS) {
        break;
      }

      compactHistory.push({
        role: message.role,
        content,
      });
      usedChars = nextChars;
    }

    return compactHistory;
  }, [conversation.messages]);

  useEffect(() => {
    captureRef.current = capturing;
  }, [capturing]);

  const applySegmentUpdate = useCallback(
    (updater: (current: TranscriptSegment[]) => TranscriptSegment[]) => {
      const next = updater(segmentsRef.current);

      if (next === segmentsRef.current) {
        return next;
      }

      segmentsRef.current = next;

      if (transcriptFlushFrameRef.current === null) {
        transcriptFlushFrameRef.current = window.requestAnimationFrame(() => {
          transcriptFlushFrameRef.current = null;
          setSegments(segmentsRef.current);
        });
      }

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
      const droppedBefore = handle.droppedQueueChunks;
      sendRealtimeChunkInternal(handle, chunk, REALTIME_QUEUE_LIMIT);

      if (handle.droppedQueueChunks <= droppedBefore) {
        return;
      }

      const now = Date.now();
      const source = handle.label;
      const lastWarningAt = lastDroppedQueueWarningAtRef.current[source] || 0;
      if (now - lastWarningAt < REALTIME_DROP_WARNING_COOLDOWN_MS) {
        return;
      }

      lastDroppedQueueWarningAtRef.current[source] = now;
      const droppedCount = handle.droppedQueueChunks;
      console.warn(
        `[SystemAudio][${source}] dropped ${droppedCount} realtime queued chunk${droppedCount === 1 ? "" : "s"}.`
      );
      setError(
        `Realtime ${source} stream is overloaded. Some audio chunks were dropped.`
      );
    },
    []
  );

  const micRefs = useMemo<MicCaptureRefs>(
    () => ({
      micMediaStreamRef,
      micAudioContextRef,
      micWorkletNodeRef,
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

  const recordLatencyMark = useCallback(
    (stage: SystemAudioLatencyStage, atMs: number = Date.now()) => {
      latencyEventsRef.current[stage] = atMs;

      const answerTriggerAt = latencyEventsRef.current.answer_trigger;
      if (!answerTriggerAt) {
        return;
      }

      const promptAt = latencyEventsRef.current.prompt_assembled;
      const firstChunkAt = latencyEventsRef.current.llm_first_chunk;
      const doneAt = latencyEventsRef.current.llm_stream_done;

      const nextSamples: Record<string, number[]> = {
        answerTriggerToPromptMs: [...latencySamplesRef.current.answerTriggerToPromptMs],
        answerTriggerToFirstChunkMs: [
          ...latencySamplesRef.current.answerTriggerToFirstChunkMs,
        ],
        answerTriggerToDoneMs: [...latencySamplesRef.current.answerTriggerToDoneMs],
        promptToFirstChunkMs: [...latencySamplesRef.current.promptToFirstChunkMs],
        firstChunkToDoneMs: [...latencySamplesRef.current.firstChunkToDoneMs],
      };

      const pushSample = (key: keyof typeof nextSamples, value: number | null) => {
        if (value === null || !Number.isFinite(value) || value < 0) {
          return;
        }

        nextSamples[key].push(Math.round(value));
        if (nextSamples[key].length > LATENCY_SAMPLES_LIMIT) {
          nextSamples[key] = nextSamples[key].slice(-LATENCY_SAMPLES_LIMIT);
        }
      };

      if (stage === "prompt_assembled" && promptAt) {
        pushSample("answerTriggerToPromptMs", promptAt - answerTriggerAt);
      }

      if (stage === "llm_first_chunk" && firstChunkAt) {
        pushSample("answerTriggerToFirstChunkMs", firstChunkAt - answerTriggerAt);
        if (promptAt) {
          pushSample("promptToFirstChunkMs", firstChunkAt - promptAt);
        }
      }

      if (stage === "llm_stream_done" && doneAt) {
        pushSample("answerTriggerToDoneMs", doneAt - answerTriggerAt);
        if (firstChunkAt) {
          pushSample("firstChunkToDoneMs", doneAt - firstChunkAt);
        }
      }

      latencySamplesRef.current = nextSamples;

      const sampleCount = Math.max(
        nextSamples.answerTriggerToPromptMs.length,
        nextSamples.answerTriggerToFirstChunkMs.length,
        nextSamples.answerTriggerToDoneMs.length,
        nextSamples.promptToFirstChunkMs.length,
        nextSamples.firstChunkToDoneMs.length
      );

      setLatencySnapshot({
        startedAt: answerTriggerAt,
        sampleCount,
        answerTriggerToPromptMs: buildLatencyMetric(
          nextSamples.answerTriggerToPromptMs
        ),
        answerTriggerToFirstChunkMs: buildLatencyMetric(
          nextSamples.answerTriggerToFirstChunkMs
        ),
        answerTriggerToDoneMs: buildLatencyMetric(nextSamples.answerTriggerToDoneMs),
        promptToFirstChunkMs: buildLatencyMetric(nextSamples.promptToFirstChunkMs),
        firstChunkToDoneMs: buildLatencyMetric(nextSamples.firstChunkToDoneMs),
      });
    },
    []
  );

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
    return buildImagesPayloadInternal(manualScreenshotsRef.current);
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

      const fullPrompt = userMessage.trim();
      if (!fullPrompt) {
        return false;
      }

      if (!latencyEventsRef.current.answer_trigger) {
        const fallbackStart = Date.now();
        latencyEventsRef.current = {
          answer_trigger: fallbackStart,
        };
        recordLatencyMark("answer_trigger", fallbackStart);
      }

      recordLatencyMark("prompt_assembled", Date.now());

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      pipelineBusyRef.current = true;

      if (aiResponseFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(aiResponseFlushFrameRef.current);
        aiResponseFlushFrameRef.current = null;
      }
      aiResponseBufferRef.current = "";

      setIsAIProcessing(true);
      setIsProcessing(false);
      setError("");
      setLastAIResponse("");

      const timestamp = Date.now();
      const previousMessages = getPreviousMessages();

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
      let firstChunkRecorded = false;
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
          if (!firstChunkRecorded) {
            firstChunkRecorded = true;
            recordLatencyMark("llm_first_chunk", Date.now());
          }

          fullResponse += chunk;

          if (fullResponse.length > MAX_AI_RESPONSE_BUFFER_CHARS) {
            fullResponse = fullResponse.slice(-MAX_AI_RESPONSE_BUFFER_CHARS);
          }

          aiResponseBufferRef.current += chunk;
          if (aiResponseFlushFrameRef.current === null) {
            aiResponseFlushFrameRef.current = window.requestAnimationFrame(() => {
              aiResponseFlushFrameRef.current = null;
              const buffered = aiResponseBufferRef.current;
              if (!buffered) {
                return;
              }

              aiResponseBufferRef.current = "";
              setLastAIResponse((previous) => previous + buffered);
            });
          }
        }

        if (aiResponseFlushFrameRef.current !== null) {
          window.cancelAnimationFrame(aiResponseFlushFrameRef.current);
          aiResponseFlushFrameRef.current = null;
        }

        const buffered = aiResponseBufferRef.current;
        if (buffered) {
          aiResponseBufferRef.current = "";
          setLastAIResponse((previous) => previous + buffered);
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
        recordLatencyMark("llm_stream_done", Date.now());
        return true;
      } catch (aiError) {
        if (!controller.signal.aborted) {
          recordLatencyMark("llm_error", Date.now());
        }
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
        pipelineBusyRef.current = false;
        latencyEventsRef.current = {};
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
      recordLatencyMark,
      selectedAIProvider,
    ]
  );

  const processPendingAnswer = useCallback(
    async (typedInstruction?: string): Promise<boolean> => {
      const trimmedInstruction = typedInstruction?.trim() ?? "";

      if ((!capturing && !trimmedInstruction) || answerTriggerInFlightRef.current) {
        return false;
      }

      answerTriggerInFlightRef.current = true;
      setIsProcessing(true);
      setError("");

      const triggerTs = Date.now();
      latencyEventsRef.current = {
        answer_trigger: triggerTs,
      };
      recordLatencyMark("answer_trigger", triggerTs);

      try {
        let prompt = "";

        if (capturing) {
          const mergedPrompt = mergeTranscriptForPrompt(
            segmentsRef.current,
            triggerTs
          ).trim();

          if (!mergedPrompt && !trimmedInstruction) {
            setIsProcessing(false);
            setError("No transcript available yet. Keep speaking and try again.");
            return false;
          }

          prompt = mergedPrompt;
          if (trimmedInstruction) {
            prompt = prompt
              ? `${prompt}\n\nInstruction: ${trimmedInstruction}`
              : trimmedInstruction;
          }
        } else {
          prompt = trimmedInstruction;
        }

        const imagesBase64 = buildImagesPayload();
        const sent = await runAI(prompt, imagesBase64);
        if (sent && capturing) {
          applySegmentUpdate((previous) => retainUnsentSegments(previous, triggerTs));
          clearPendingRealtimeState();
        }

        return sent;
      } finally {
        answerTriggerInFlightRef.current = false;
        setIsProcessing(false);
      }
    },
    [
      applySegmentUpdate,
      buildImagesPayload,
      capturing,
      clearPendingRealtimeState,
      recordLatencyMark,
      runAI,
    ]
  );

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
          if (handle.droppedQueueChunks > 0) {
            const droppedCount = handle.droppedQueueChunks;
            console.warn(
              `[SystemAudio][${source}] reconnect flushing queue after ${droppedCount} dropped chunk${droppedCount === 1 ? "" : "s"}.`
            );
          }

          handle.droppedQueueChunks = 0;

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

          const now = Date.now();
          if (now - lastRealtimeErrorAtRef.current < REALTIME_ERROR_THROTTLE_MS) {
            return;
          }

          lastRealtimeErrorAtRef.current = now;
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
      await Promise.all([
        connectRealtime(interviewerRealtimeRef.current, "interviewer", sampleRate, signal),
        (async () => {
          startPhase = "connect_user_realtime";
          await connectRealtime(userRealtimeRef.current, "user", MIC_SAMPLE_RATE, signal);
        })(),
      ]);

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
    selectedAudioDevices.output.id,
    startMicCapture,
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

  const onAnswerTrigger = useCallback(
    async (typedInstruction?: string): Promise<boolean> => {
      if (capturing) {
        commitBothStreams();
        commitLatestPartialTranscripts({
          latestPartialInterviewerRef,
          latestPartialUserRef,
          pendingCommitEchoRef,
          appendCommittedTranscript,
        });
      }

      return processPendingAnswer(typedInstruction);
    },
    [
      appendCommittedTranscript,
      capturing,
      commitBothStreams,
      processPendingAnswer,
    ]
  );

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
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (transcriptFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(transcriptFlushFrameRef.current);
        transcriptFlushFrameRef.current = null;
      }
      if (aiResponseFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(aiResponseFlushFrameRef.current);
        aiResponseFlushFrameRef.current = null;
      }
      void tauriCommands.stopSystemAudioCapture().catch(() => {
        // no-op
      });
    };
  }, [
    closeRealtimeSystems,
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
    latencySnapshot,
    isCapturingScreenshot,
    handleCaptureScreenshot,
    onAnswerTrigger,
    scrollAreaRef,
    maxManualScreenshots,
    updateMaxManualScreenshots,
  };
}
