import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  CommitStrategy,
  RealtimeConnection,
  RealtimeEvents,
  Scribe,
} from "@elevenlabs/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useApp } from "@/contexts";
import { useGlobalShortcuts, useWindowResize } from ".";
import {
  fetchAIResponse,
  fetchElevenLabsRealtimeToken,
  getElevenLabsAudioFormat,
  getElevenLabsRealtimeConfig,
  getSystemAudioInterviewSettings,
  updateSystemAudioInterviewSettings,
  safeLocalStorage,
  generateConversationTitle,
  saveConversation,
  CONVERSATION_SAVE_DEBOUNCE_MS,
  generateConversationId,
  generateMessageId,
} from "@/lib";
import { DEFAULT_SYSTEM_PROMPT } from "@/config";
import {
  type SystemAudioInterviewSettings,
  type TranscriptSegment,
  type TranscriptSource,
} from "@/types";
import { normalizeTranscription } from "@/lib/utils";

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

type RealtimeAudioChunkEvent = {
  sample_rate: number;
  audio_base64: string;
};

type RealtimeHandle = {
  connection: RealtimeConnection | null;
  ready: boolean;
  shouldReconnect: boolean;
  reconnecting: boolean;
  queue: RealtimeAudioChunkEvent[];
};

type ManualScreenshot = {
  id: string;
  base64: string;
  timestamp: number;
};

type PendingCommitEcho = {
  partialText: string;
  timestamp: number;
};

const SYSTEM_AUDIO_SCREENSHOT_INTERVAL_MS = 2000;
const MIC_SAMPLE_RATE = 16000;
const MIC_FRAME_SIZE = 1536;
const MIC_PREBUFFER_LIMIT = 12;
const MAX_TRANSCRIPT_SEGMENTS = 300;
const PENDING_COMMIT_ECHO_TTL_MS = 5000;

const initialConversation = (): ChatConversation => ({
  id: generateConversationId("sysaudio"),
  title: "",
  messages: [],
  createdAt: 0,
  updatedAt: 0,
});

function float32ToPcm16Base64(frame: Float32Array): string {
  const buffer = new ArrayBuffer(frame.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < frame.length; i++) {
    const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
    const pcm =
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(i * 2, pcm, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createSegment(
  source: TranscriptSource,
  text: string,
  isLive: boolean = false
): TranscriptSegment {
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source,
    text,
    timestamp: Date.now(),
    isLive,
  };
}

function trimSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= MAX_TRANSCRIPT_SEGMENTS) {
    return segments;
  }
  return segments.slice(segments.length - MAX_TRANSCRIPT_SEGMENTS);
}

function replaceLiveSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  text: string
): TranscriptSegment[] {
  const normalizedText = normalizeTranscription(text).trim();
  if (!normalizedText) {
    return segments;
  }

  const next = [...segments];
  const liveIndex = next.findIndex((item) => item.source === source && item.isLive);
  if (liveIndex >= 0) {
    next[liveIndex] = {
      ...next[liveIndex],
      text: normalizedText,
      timestamp: Date.now(),
    };
  } else {
    next.push(createSegment(source, normalizedText, true));
  }

  return trimSegments(next);
}

function commitSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  text: string
): TranscriptSegment[] {
  const normalizedText = normalizeTranscription(text).trim();

  let next = segments.filter(
    (item) => !(item.source === source && item.isLive)
  );

  if (!normalizedText) {
    return trimSegments(next);
  }

  const committed = createSegment(source, normalizedText, false);
  next = [...next, committed].sort((a, b) => a.timestamp - b.timestamp);
  return trimSegments(next);
}

function replaceLatestCommittedSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  previousText: string,
  nextText: string
): TranscriptSegment[] | null {
  const normalizedPrevious = normalizeTranscription(previousText).trim();
  const normalizedNext = normalizeTranscription(nextText).trim();
  if (!normalizedNext) {
    return null;
  }

  const next = [...segments];
  for (let i = next.length - 1; i >= 0; i--) {
    const segment = next[i];
    if (segment.source !== source || segment.isLive) {
      continue;
    }

    if (!normalizedPrevious || segment.text === normalizedPrevious) {
      next[i] = {
        ...segment,
        text: normalizedNext,
      };
      return trimSegments(next);
    }
  }

  return null;
}

function mergeTranscriptForPrompt(
  segments: TranscriptSegment[],
  cutoffAt?: number
): string {
  return segments
    .filter((item) => !item.isLive)
    .filter((item) => (typeof cutoffAt === "number" ? item.timestamp <= cutoffAt : true))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => {
      const label = item.source === "interviewer" ? "Interviewer" : "User";
      return `${label}: "${item.text}"`;
    })
    .join("\n");
}

function retainUnsentSegments(
  segments: TranscriptSegment[],
  cutoffAt: number
): TranscriptSegment[] {
  return trimSegments(
    segments.filter((item) => item.isLive || item.timestamp > cutoffAt)
  );
}

export type useSystemAudioType = ReturnType<typeof useSystemAudio>;

export function useSystemAudio() {
  const { resizeWindow } = useWindowResize();
  const globalShortcuts = useGlobalShortcuts();
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

  const interviewerRealtimeRef = useRef<RealtimeHandle>({
    connection: null,
    ready: false,
    shouldReconnect: false,
    reconnecting: false,
    queue: [],
  });

  const userRealtimeRef = useRef<RealtimeHandle>({
    connection: null,
    ready: false,
    shouldReconnect: false,
    reconnecting: false,
    queue: [],
  });

  const micMediaStreamRef = useRef<MediaStream | null>(null);
  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micPreBufferRef = useRef<string[]>([]);
  const micFrameBufferRef = useRef<Float32Array>(new Float32Array(0));
  const userSpeechLikelyRef = useRef(false);

  const liveTranscript = useMemo(() => {
    return segments
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-12);
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
        await invoke("update_vad_config", { config });
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

  const flushRealtimeQueue = useCallback((handle: RealtimeHandle) => {
    if (!handle.connection || !handle.ready) {
      return;
    }

    while (handle.queue.length > 0) {
      const chunk = handle.queue.shift();
      if (!chunk) {
        break;
      }

      handle.connection.send({
        audioBase64: chunk.audio_base64,
        sampleRate: chunk.sample_rate,
      });
    }
  }, []);

  const sendRealtimeChunk = useCallback(
    (handle: RealtimeHandle, chunk: RealtimeAudioChunkEvent) => {
      if (!handle.connection || !handle.ready) {
        handle.queue.push(chunk);
        return;
      }

      handle.connection.send({
        audioBase64: chunk.audio_base64,
        sampleRate: chunk.sample_rate,
      });
    },
    []
  );

  const closeRealtimeHandle = useCallback((handle: RealtimeHandle) => {
    handle.ready = false;
    handle.queue = [];
    handle.shouldReconnect = false;
    handle.reconnecting = false;
    if (handle.connection) {
      try {
        handle.connection.close();
      } catch (closeError) {
        console.warn("Failed to close realtime connection:", closeError);
      }
    }
    handle.connection = null;
  }, []);

  const stopMicCapture = useCallback(() => {
    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current.onaudioprocess = null;
      micProcessorRef.current = null;
    }

    if (micSourceNodeRef.current) {
      micSourceNodeRef.current.disconnect();
      micSourceNodeRef.current = null;
    }

    if (micAudioContextRef.current) {
      void micAudioContextRef.current.close();
      micAudioContextRef.current = null;
    }

    if (micMediaStreamRef.current) {
      micMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      micMediaStreamRef.current = null;
    }

    micPreBufferRef.current = [];
    micFrameBufferRef.current = new Float32Array(0);
    userSpeechLikelyRef.current = false;
  }, []);

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
        const base64 = (await invoke("capture_to_base64")) as string;
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

  const handleCaptureScreenshot = useCallback(async () => {
    if (isCapturingScreenshot) {
      return;
    }

    setIsCapturingScreenshot(true);
    try {
      const base64 = (await invoke("capture_to_base64")) as string;

      const manual: ManualScreenshot = {
        id: `manual-ss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        base64,
        timestamp: Date.now(),
      };

      setManualScreenshots((previous) => {
        const next = [...previous, manual].slice(-maxManualScreenshots);
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
    const images: string[] = [];

    if (cachedScreenshotRef.current) {
      images.push(cachedScreenshotRef.current);
    }

    for (const screenshot of manualScreenshotsRef.current) {
      images.push(screenshot.base64);
    }

    return images;
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

        setManualScreenshots([]);
        manualScreenshotsRef.current = [];
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

  const closeRealtimeSystems = useCallback(() => {
    closeRealtimeHandle(interviewerRealtimeRef.current);
    closeRealtimeHandle(userRealtimeRef.current);
    stopMicCapture();
  }, [closeRealtimeHandle, stopMicCapture]);

  const startMicCapture = useCallback(async () => {
    stopMicCapture();

    const constraints: MediaStreamConstraints = {
      audio: selectedAudioDevices.input.id
        ? {
            deviceId:
              selectedAudioDevices.input.id === "default"
                ? undefined
                : { exact: selectedAudioDevices.input.id },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          }
        : true,
      video: false,
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    micMediaStreamRef.current = stream;

    const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
    micAudioContextRef.current = context;

    const sourceNode = context.createMediaStreamSource(stream);
    micSourceNodeRef.current = sourceNode;

    const processor = context.createScriptProcessor(MIC_FRAME_SIZE, 1, 1);
    micProcessorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (!captureRef.current) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);

      let merged = new Float32Array(micFrameBufferRef.current.length + copy.length);
      merged.set(micFrameBufferRef.current, 0);
      merged.set(copy, micFrameBufferRef.current.length);

      while (merged.length >= MIC_FRAME_SIZE) {
        const frame = merged.slice(0, MIC_FRAME_SIZE);
        merged = merged.slice(MIC_FRAME_SIZE);

        const rms = Math.sqrt(
          frame.reduce((acc, sample) => acc + sample * sample, 0) / frame.length
        );

        const frameBase64 = float32ToPcm16Base64(frame);

        if (rms > 0.01) {
          userSpeechLikelyRef.current = true;
          sendRealtimeChunk(userRealtimeRef.current, {
            sample_rate: MIC_SAMPLE_RATE,
            audio_base64: frameBase64,
          });
        } else if (userSpeechLikelyRef.current) {
          micPreBufferRef.current.push(frameBase64);
          if (micPreBufferRef.current.length > MIC_PREBUFFER_LIMIT) {
            micPreBufferRef.current.shift();
          }

          for (const buffered of micPreBufferRef.current) {
            sendRealtimeChunk(userRealtimeRef.current, {
              sample_rate: MIC_SAMPLE_RATE,
              audio_base64: buffered,
            });
          }
          micPreBufferRef.current = [];
          userSpeechLikelyRef.current = false;
        }
      }

      micFrameBufferRef.current = merged;
    };

    sourceNode.connect(processor);
    processor.connect(context.destination);
  }, [selectedAudioDevices.input.id, sendRealtimeChunk, stopMicCapture]);

  const connectRealtime = useCallback(
    async (
      handle: RealtimeHandle,
      source: TranscriptSource,
      sampleRate: number
    ) => {
      const { apiKey, model } = getElevenLabsRealtimeConfig(selectedSttProvider);
      const token = await fetchElevenLabsRealtimeToken(apiKey);

      const connection = Scribe.connect({
        token,
        modelId: model,
        commitStrategy: CommitStrategy.MANUAL,
        audioFormat: getElevenLabsAudioFormat(sampleRate),
        sampleRate,
      });

      handle.connection = connection;
      handle.ready = false;
      handle.shouldReconnect = true;
      handle.queue = [];

      connection.on(RealtimeEvents.OPEN, () => {
        handle.ready = true;
        flushRealtimeQueue(handle);
      });

      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
        const text = normalizeTranscription(data.text).trim();
        if (!text) {
          return;
        }

        if (source === "interviewer") {
          latestPartialInterviewerRef.current = text;
        } else {
          latestPartialUserRef.current = text;
        }

        appendLiveTranscript(source, text);
      });

      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
        const text = normalizeTranscription(data.text).trim();
        if (!text) {
          return;
        }

        const pending = pendingCommitEchoRef.current[source];
        if (pending) {
          const age = Date.now() - pending.timestamp;
          if (age > PENDING_COMMIT_ECHO_TTL_MS) {
            pendingCommitEchoRef.current[source] = undefined;
            return;
          } else if (pending.partialText === text) {
            pendingCommitEchoRef.current[source] = undefined;
            return;
          } else {
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
        }

        appendCommittedTranscript(source, text);
      });

      connection.on(RealtimeEvents.ERROR, (event) => {
        console.error(`ElevenLabs ${source} realtime error:`, event);
        setError(event.error || "Realtime transcription failed.");
      });

      connection.on(RealtimeEvents.CLOSE, () => {
        handle.ready = false;
        if (handle.connection === connection) {
          handle.connection = null;
        }
      });
    },
    [
      applySegmentUpdate,
      appendCommittedTranscript,
      appendLiveTranscript,
      flushRealtimeQueue,
      selectedSttProvider,
    ]
  );

  const startCapture = useCallback(async () => {
    try {
      setError("");

      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (!hasAccess) {
        setSetupRequired(true);
        setIsPopoverOpen(true);
        return;
      }

      const deviceId =
        selectedAudioDevices.output.id !== "default"
          ? selectedAudioDevices.output.id
          : null;

      const sampleRate = await invoke<number>("get_audio_sample_rate", {
        deviceId,
      });

      setConversation(initialConversation());
      resetInterviewState();
      setLastAIResponse("");
      setManualScreenshots([]);
      manualScreenshotsRef.current = [];
      setSetupRequired(false);
      setIsPopoverOpen(true);
      setCapturing(true);

      interviewerRealtimeRef.current.shouldReconnect = true;
      userRealtimeRef.current.shouldReconnect = true;

      await connectRealtime(interviewerRealtimeRef.current, "interviewer", sampleRate);
      await connectRealtime(userRealtimeRef.current, "user", MIC_SAMPLE_RATE);

      await startMicCapture();
      schedulePeriodicScreenshotCapture();

      await invoke<string>("stop_system_audio_capture");
      await invoke<string>("start_system_audio_capture", {
        vadConfig,
        deviceId,
      });
    } catch (startError) {
      closeRealtimeSystems();
      stopPeriodicScreenshotCapture();
      setCapturing(false);
      setIsPopoverOpen(true);
      setError(
        startError instanceof Error
          ? startError.message
          : "Failed to start system audio capture"
      );
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
  ]);

  const stopCapture = useCallback(async () => {
    try {
      closeRealtimeSystems();
      stopPeriodicScreenshotCapture();

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      await invoke<string>("stop_system_audio_capture");

      setCapturing(false);
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
    }
  }, [closeRealtimeSystems, resetInterviewState, stopPeriodicScreenshotCapture]);

  const commitBothStreams = useCallback(() => {
    const interviewer = interviewerRealtimeRef.current;
    const user = userRealtimeRef.current;

    if (interviewer.connection && interviewer.ready) {
      interviewer.connection.commit();
      const preview = latestPartialInterviewerRef.current.trim();
      if (preview) {
        pendingCommitEchoRef.current.interviewer = {
          partialText: preview,
          timestamp: Date.now(),
        };
      }
    }

    if (user.connection && user.ready) {
      user.connection.commit();
      const preview = latestPartialUserRef.current.trim();
      if (preview) {
        pendingCommitEchoRef.current.user = {
          partialText: preview,
          timestamp: Date.now(),
        };
      }
    }
  }, []);

  const onAnswerTrigger = useCallback(async () => {
    if (!capturing) {
      return;
    }

    commitBothStreams();

    const partialInterviewer = latestPartialInterviewerRef.current;
    if (partialInterviewer) {
      appendCommittedTranscript("interviewer", partialInterviewer);
      pendingCommitEchoRef.current.interviewer = {
        partialText: partialInterviewer,
        timestamp: Date.now(),
      };
      latestPartialInterviewerRef.current = "";
    }

    const partialUser = latestPartialUserRef.current;
    if (partialUser) {
      appendCommittedTranscript("user", partialUser);
      pendingCommitEchoRef.current.user = {
        partialText: partialUser,
        timestamp: Date.now(),
      };
      latestPartialUserRef.current = "";
    }

    await processPendingAnswer();
  }, [
    appendCommittedTranscript,
    capturing,
    commitBothStreams,
    processPendingAnswer,
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
    globalShortcuts.registerSystemAudioCallback(async () => {
      if (captureRef.current) {
        await stopCapture();
      } else {
        await startCapture();
      }
    });

    globalShortcuts.registerAnswerTriggerCallback(async () => {
      await onAnswerTrigger();
    });
  }, [globalShortcuts, onAnswerTrigger, startCapture, stopCapture]);

  useEffect(() => {
    let unlistenRealtimeChunk: (() => void) | undefined;

    const setup = async () => {
      unlistenRealtimeChunk = await listen("speech-realtime-chunk", (event) => {
        if (!captureRef.current) {
          return;
        }

        try {
          sendRealtimeChunk(
            interviewerRealtimeRef.current,
            event.payload as RealtimeAudioChunkEvent
          );
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
  }, [sendRealtimeChunk]);

  useEffect(() => {
    const shouldOpenPopover =
      capturing || setupRequired || !!error || isAIProcessing || !!lastAIResponse;
    setIsPopoverOpen(shouldOpenPopover);
    void resizeWindow(shouldOpenPopover);
  }, [capturing, setupRequired, error, isAIProcessing, lastAIResponse, resizeWindow]);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<SystemAudioInterviewSettings>;
      if (!customEvent.detail) {
        return;
      }
      setSettings(customEvent.detail);
    };

    window.addEventListener(
      "systemAudioInterviewSettingsChanged",
      onSettingsChanged as EventListener
    );

    return () => {
      window.removeEventListener(
        "systemAudioInterviewSettingsChanged",
        onSettingsChanged as EventListener
      );
    };
  }, []);

  useEffect(() => {
    return () => {
      closeRealtimeSystems();
      stopPeriodicScreenshotCapture();
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      void invoke("stop_system_audio_capture").catch(() => {
        // no-op
      });
    };
  }, [closeRealtimeSystems, stopPeriodicScreenshotCapture]);

  const handleSetup = useCallback(async () => {
    try {
      const platform = navigator.platform.toLowerCase();
      if (platform.includes("mac") || platform.includes("win")) {
        await invoke("request_system_audio_access");
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
      const hasAccess = await invoke<boolean>("check_system_audio_access");
      if (hasAccess) {
        setSetupRequired(false);
        await startCapture();
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
    setManualScreenshots([]);
    manualScreenshotsRef.current = [];
  }, [resetInterviewState]);

  const cacheAgeLabel = useMemo(() => {
    if (!cacheUpdatedAt) {
      return "No cache yet";
    }

    const age = Date.now() - cacheUpdatedAt;
    if (age < 2000) {
      return "Fresh (<2s)";
    }
    if (age < 6000) {
      return "Warm (<6s)";
    }
    return "Stale";
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
    resizeWindow,
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
