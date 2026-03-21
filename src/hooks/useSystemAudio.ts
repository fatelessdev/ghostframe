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
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import {
  ELEVENLABS_REALTIME_DEFAULT_BASE_URI,
  ELEVENLABS_REALTIME_FALLBACK_BASE_URIS,
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
  label: TranscriptSource;
  connection: RealtimeConnection | null;
  connectionId: number | null;
  ready: boolean;
  shouldReconnect: boolean;
  reconnecting: boolean;
  reconnectTimeoutId: number | null;
  connectAttempts: number;
  activeBaseUri: string | null;
  activeSampleRate: number | null;
  errorLabel: string;
  keepAliveIntervalId: number | null;
  lastSentAtMs: number;
  uncommittedAudioMs: number;
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

type CaptureTrigger = "manual" | "shortcut" | "setup";

const SYSTEM_AUDIO_SCREENSHOT_INTERVAL_MS = 2000;
const MIC_SAMPLE_RATE = 16000;
const MIC_FRAME_SIZE = 1024;
const MIC_PREBUFFER_LIMIT = 12;
const MAX_TRANSCRIPT_SEGMENTS = 300;
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

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
};

const isCaptureAlreadyRunningError = (value: unknown): boolean => {
  return toErrorMessage(value).toLowerCase().includes("capture already running");
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const estimatePcm16DurationMs = (audioBase64: string, sampleRate: number): number => {
  if (!audioBase64 || sampleRate <= 0) {
    return 0;
  }

  const padding = audioBase64.endsWith("==") ? 2 : audioBase64.endsWith("=") ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((audioBase64.length * 3) / 4) - padding);
  const sampleCount = byteLength / 2;
  return (sampleCount / sampleRate) * 1000;
};

const toUniqueBaseUris = (preferred: (string | null | undefined)[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];

  for (const value of preferred) {
    if (!value) {
      continue;
    }

    if (!seen.has(value)) {
      seen.add(value);
      next.push(value);
    }
  }

  return next;
};

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

  const interviewerRealtimeRef = useRef<RealtimeHandle>({
    label: "interviewer",
    connection: null,
    connectionId: null,
    ready: false,
    shouldReconnect: false,
    reconnecting: false,
    reconnectTimeoutId: null,
    connectAttempts: 0,
    activeBaseUri: null,
    activeSampleRate: null,
    errorLabel: "",
    keepAliveIntervalId: null,
    lastSentAtMs: 0,
    uncommittedAudioMs: 0,
    queue: [],
  });

  const userRealtimeRef = useRef<RealtimeHandle>({
    label: "user",
    connection: null,
    connectionId: null,
    ready: false,
    shouldReconnect: false,
    reconnecting: false,
    reconnectTimeoutId: null,
    connectAttempts: 0,
    activeBaseUri: null,
    activeSampleRate: null,
    errorLabel: "",
    keepAliveIntervalId: null,
    lastSentAtMs: 0,
    uncommittedAudioMs: 0,
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
      handle.lastSentAtMs = Date.now();
      handle.uncommittedAudioMs += estimatePcm16DurationMs(
        chunk.audio_base64,
        chunk.sample_rate
      );
    }
  }, []);

  const sendRealtimeChunk = useCallback(
    (handle: RealtimeHandle, chunk: RealtimeAudioChunkEvent) => {
      if (!handle.connection || !handle.ready) {
        handle.queue.push(chunk);
        if (handle.queue.length > REALTIME_QUEUE_LIMIT) {
          handle.queue.shift();
        }
        return;
      }

      handle.connection.send({
        audioBase64: chunk.audio_base64,
        sampleRate: chunk.sample_rate,
      });
      handle.lastSentAtMs = Date.now();
      handle.uncommittedAudioMs += estimatePcm16DurationMs(
        chunk.audio_base64,
        chunk.sample_rate
      );
    },
    []
  );

  const closeRealtimeHandle = useCallback(
    (
      handle: RealtimeHandle,
      options?: { preserveReconnect?: boolean; reason?: string }
    ) => {
      const preserveReconnect = options?.preserveReconnect ?? false;
      const reason = options?.reason || "unknown";

      if (handle.reconnectTimeoutId !== null) {
        window.clearTimeout(handle.reconnectTimeoutId);
        handle.reconnectTimeoutId = null;
      }

      if (handle.keepAliveIntervalId !== null) {
        window.clearInterval(handle.keepAliveIntervalId);
        handle.keepAliveIntervalId = null;
      }

      handle.ready = false;
      handle.queue = [];
      if (!preserveReconnect) {
        handle.shouldReconnect = false;
      }
      handle.reconnecting = false;
      handle.connectAttempts = 0;
      handle.activeBaseUri = null;
      handle.activeSampleRate = null;
      handle.errorLabel = "";
      handle.lastSentAtMs = 0;
      handle.uncommittedAudioMs = 0;
      handle.connectionId = null;
      if (handle.connection) {
        console.info(
          `[SystemAudio][${handle.label}] closing realtime connection (${reason})`
        );
        try {
          handle.connection.close();
        } catch (closeError) {
          console.warn("Failed to close realtime connection:", closeError);
        }
      }
      handle.connection = null;
    },
    []
  );

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

  const waitForBackendCaptureState = useCallback(
    async (expected: boolean): Promise<boolean> => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < SYSTEM_AUDIO_CAPTURE_STATUS_TIMEOUT_MS) {
        try {
          const state = await invoke<boolean>("get_capture_status");
          if (state === expected) {
            return true;
          }
        } catch (statusError) {
          console.warn("[SystemAudio] failed to read capture status:", statusError);
          return false;
        }

        await wait(SYSTEM_AUDIO_CAPTURE_STATUS_POLL_MS);
      }

      return false;
    },
    []
  );

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

  const closeRealtimeSystems = useCallback(
    (reason: string) => {
      closeRealtimeHandle(interviewerRealtimeRef.current, { reason });
      closeRealtimeHandle(userRealtimeRef.current, { reason });
      stopMicCapture();
    },
    [closeRealtimeHandle, stopMicCapture]
  );

  const startMicCapture = useCallback(async () => {
    stopMicCapture();

    const selectedInputId = selectedAudioDevices.input.id;
    const hasSpecificInput = !!selectedInputId && selectedInputId !== "default";
    const processedAudioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    const micConstraintAttempts: Array<{
      label: string;
      constraints: MediaStreamConstraints;
    }> = [];

    if (hasSpecificInput) {
      micConstraintAttempts.push(
        {
          label: `specific:${selectedInputId}:strict`,
          constraints: {
            audio: {
              deviceId: { exact: selectedInputId },
              ...processedAudioConstraints,
              channelCount: 1,
            },
            video: false,
          },
        },
        {
          label: `specific:${selectedInputId}:relaxed`,
          constraints: {
            audio: {
              deviceId: { exact: selectedInputId },
              ...processedAudioConstraints,
            },
            video: false,
          },
        }
      );
    }

    micConstraintAttempts.push(
      {
        label: "default:strict",
        constraints: {
          audio: {
            ...processedAudioConstraints,
            channelCount: 1,
          },
          video: false,
        },
      },
      {
        label: "default:processed",
        constraints: {
          audio: processedAudioConstraints,
          video: false,
        },
      },
      {
        label: "default:raw",
        constraints: {
          audio: true,
          video: false,
        },
      }
    );

    let stream: MediaStream | null = null;
    let lastMicError: unknown = null;

    for (let attemptIndex = 0; attemptIndex < micConstraintAttempts.length; attemptIndex++) {
      const attempt = micConstraintAttempts[attemptIndex];

      try {
        stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
        if (attemptIndex > 0) {
          console.warn(
            `[SystemAudio] microphone fallback succeeded via ${attempt.label}`
          );
        }
        break;
      } catch (micError) {
        lastMicError = micError;
        console.warn(
          `[SystemAudio] microphone constraints failed (${attempt.label}): ${toErrorMessage(
            micError
          )}`
        );
      }
    }

    if (!stream) {
      if (lastMicError instanceof OverconstrainedError) {
        throw new Error(
          `Microphone constraints not supported (${lastMicError.constraint || "unknown"}). Try changing your input device in settings.`
        );
      }

      if (lastMicError instanceof Error) {
        throw lastMicError;
      }

      throw new Error("Failed to access microphone for realtime user transcription.");
    }

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
      sampleRate: number,
      signal: AbortSignal
    ) => {
      const { apiKey, model, baseUri, tokenBaseUrl } =
        getElevenLabsRealtimeConfig(selectedSttProvider);
      const candidateBaseUris = toUniqueBaseUris([
        baseUri,
        ELEVENLABS_REALTIME_DEFAULT_BASE_URI,
        ...ELEVENLABS_REALTIME_FALLBACK_BASE_URIS,
      ]);

      if (candidateBaseUris.length === 0) {
        throw new Error("No valid realtime WebSocket endpoint configured.");
      }

      const audioFormat = getElevenLabsAudioFormat(sampleRate);
      let lastOpenError: string | null = null;

      for (const candidateBaseUri of candidateBaseUris) {
        const derivedTokenBaseUrl = candidateBaseUri
          .replace(/^wss:\/\//i, "https://")
          .replace(/^ws:\/\//i, "http://");

        const tokenBaseCandidates = toUniqueBaseUris([
          tokenBaseUrl,
          derivedTokenBaseUrl,
          "https://api.elevenlabs.io",
        ]);

        for (let attempt = 1; attempt <= REALTIME_MAX_CONNECT_ATTEMPTS; attempt++) {
          if (signal.aborted) {
            throw new Error("Realtime connection cancelled");
          }

          if (handle.connection) {
            closeRealtimeHandle(handle, {
              preserveReconnect: true,
              reason: `reconnect_attempt:${source}:${attempt}`,
            });
          }

          const activeTokenBaseUrl =
            tokenBaseCandidates[
              Math.min(attempt - 1, Math.max(tokenBaseCandidates.length - 1, 0))
            ] || "https://api.elevenlabs.io";
          const connectionId = ++realtimeConnectionSeqRef.current;

          try {
            const token = await fetchElevenLabsRealtimeToken(apiKey, {
              model,
              tokenBaseUrl: activeTokenBaseUrl,
            });

            if (signal.aborted) {
              throw new Error("Realtime connection cancelled");
            }

            let openResolved = false;
            let sessionResolved = false;
            let settled = false;

            await new Promise<void>((resolve, reject) => {
              const connection = Scribe.connect({
                token,
                modelId: model,
                commitStrategy: CommitStrategy.MANUAL,
                audioFormat,
                sampleRate,
                ...(candidateBaseUri &&
                candidateBaseUri !== ELEVENLABS_REALTIME_DEFAULT_BASE_URI
                  ? { baseUri: candidateBaseUri }
                  : {}),
              });

              if (signal.aborted) {
                connection.close();
                return reject(new Error("Realtime connection cancelled"));
              }

              handle.connection = connection;
              handle.connectionId = connectionId;
              handle.ready = false;
              handle.shouldReconnect = true;
              if (handle.reconnectTimeoutId !== null) {
                window.clearTimeout(handle.reconnectTimeoutId);
                handle.reconnectTimeoutId = null;
              }
              handle.connectAttempts = attempt;
              handle.activeBaseUri = candidateBaseUri;
              handle.activeSampleRate = sampleRate;
              handle.errorLabel = "";
              handle.lastSentAtMs = Date.now();
              handle.uncommittedAudioMs = 0;

              const settleResolve = () => {
                if (settled) {
                  return;
                }
                settled = true;
                resolve();
              };

              const settleReject = (message: string) => {
                if (settled) {
                  return;
                }
                settled = true;
                reject(new Error(message));
              };

              const captureStructuredRealtimeError = (event: any) => {
                const eventMessage =
                  typeof event?.error === "string" && event.error.trim()
                    ? event.error.trim()
                    : event instanceof Error
                    ? event.message
                    : "";

                if (eventMessage) {
                  handle.errorLabel = eventMessage;
                }

                if (!openResolved || signal.aborted) {
                  return;
                }

                const isExpectedSocketClose =
                  eventMessage.includes("1000 - User ended session") ||
                  eventMessage.includes("insufficient_audio_activity") ||
                  eventMessage.includes("commit_throttled") ||
                  event?.message_type === "commit_throttled" ||
                  eventMessage.toLowerCase().includes("commit request ignored");

                if (isExpectedSocketClose) {
                  console.warn(
                    `[SystemAudio][${source}] transient realtime close: ${eventMessage}`
                  );
                  return;
                }

                console.error(`ElevenLabs ${source} realtime error:`, event);
                setError(eventMessage || "Realtime transcription failed.");
              };

              connection.on(RealtimeEvents.OPEN, () => {
                openResolved = true;
                console.info(
                  `[SystemAudio][${source}] realtime open via ${candidateBaseUri}`
                );
              });

              connection.on(RealtimeEvents.SESSION_STARTED, () => {
                sessionResolved = true;
                handle.ready = true;
                handle.connectAttempts = 0;
                setError("");
                flushRealtimeQueue(handle);
                console.info(
                  `[SystemAudio][${source}] session started @${sampleRate}Hz`
                );

                const bootstrapSilenceSamples = Math.max(
                  128,
                  Math.round(
                    sampleRate * (REALTIME_BOOTSTRAP_MS_OF_SILENCE / 1000)
                  )
                );
                const bootstrapSilence = new Float32Array(bootstrapSilenceSamples);
                const bootstrapAudio = float32ToPcm16Base64(bootstrapSilence);
                connection.send({
                  audioBase64: bootstrapAudio,
                  sampleRate,
                });
                handle.lastSentAtMs = Date.now();

                if (handle.keepAliveIntervalId !== null) {
                  window.clearInterval(handle.keepAliveIntervalId);
                }

                handle.keepAliveIntervalId = window.setInterval(() => {
                  if (!handle.connection || !handle.ready) {
                    return;
                  }

                  if (!handle.activeSampleRate) {
                    return;
                  }

                  if (Date.now() - handle.lastSentAtMs < REALTIME_KEEPALIVE_INTERVAL_MS) {
                    return;
                  }

                  const silenceSamples = Math.max(
                    256,
                    Math.round(handle.activeSampleRate * (REALTIME_KEEPALIVE_MS_OF_SILENCE / 1000))
                  );
                  const silence = new Float32Array(silenceSamples);
                  const keepAliveAudio = float32ToPcm16Base64(silence);
                  handle.connection.send({
                    audioBase64: keepAliveAudio,
                    sampleRate: handle.activeSampleRate,
                  });
                  handle.lastSentAtMs = Date.now();
                }, REALTIME_KEEPALIVE_INTERVAL_MS);

                settleResolve();
              });

              connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
                const text = normalizeTranscription(data.text).trim();
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
              });

              connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
                const text = normalizeTranscription(data.text).trim();
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

              connection.on(RealtimeEvents.AUTH_ERROR, captureStructuredRealtimeError);
              connection.on(
                RealtimeEvents.UNACCEPTED_TERMS,
                captureStructuredRealtimeError
              );
              connection.on(
                RealtimeEvents.QUOTA_EXCEEDED,
                captureStructuredRealtimeError
              );
              connection.on(RealtimeEvents.RATE_LIMITED, captureStructuredRealtimeError);
              connection.on(
                RealtimeEvents.TRANSCRIBER_ERROR,
                captureStructuredRealtimeError
              );
              connection.on(
                RealtimeEvents.RESOURCE_EXHAUSTED,
                captureStructuredRealtimeError
              );
              connection.on(
                RealtimeEvents.INSUFFICIENT_AUDIO_ACTIVITY,
                captureStructuredRealtimeError
              );
              connection.on(RealtimeEvents.INPUT_ERROR, captureStructuredRealtimeError);
              connection.on(RealtimeEvents.QUEUE_OVERFLOW, captureStructuredRealtimeError);
              connection.on(
                RealtimeEvents.SESSION_TIME_LIMIT_EXCEEDED,
                captureStructuredRealtimeError
              );
              connection.on(
                RealtimeEvents.CHUNK_SIZE_EXCEEDED,
                captureStructuredRealtimeError
              );
              connection.on(
                RealtimeEvents.COMMIT_THROTTLED,
                captureStructuredRealtimeError
              );

              connection.on(RealtimeEvents.ERROR, (event) => {
                captureStructuredRealtimeError(event);

                if (openResolved) {
                  return;
                }

                const reason =
                  (typeof event?.error === "string" && event.error.trim()) ||
                  handle.errorLabel ||
                  "Connection error before websocket opened";
                settleReject(
                  `Failed to open ${source} realtime stream at ${candidateBaseUri}: ${reason}`
                );
              });

              connection.on(RealtimeEvents.CLOSE, (closeEvent) => {
                if (handle.connectionId !== connectionId) {
                  console.info(
                    `[SystemAudio][${source}] close ignored for stale connection #${connectionId}; active=${handle.connectionId ?? "none"}`
                  );
                  return;
                }

                handle.ready = false;
                if (handle.keepAliveIntervalId !== null) {
                  window.clearInterval(handle.keepAliveIntervalId);
                  handle.keepAliveIntervalId = null;
                }
                handle.connection = null;
                handle.connectionId = null;
                handle.reconnectTimeoutId = null;
                handle.uncommittedAudioMs = 0;

                if (openResolved) {
                  const closeCode = closeEvent?.code ?? "unknown";
                  const closeReason = closeEvent?.reason || "No reason provided";
                  const shouldReconnect = handle.shouldReconnect && !signal.aborted;
                  console.warn(
                    `[SystemAudio][${source}] realtime closed (${closeCode}) ${closeReason}; reconnect=${shouldReconnect} (id=${connectionId}, shouldReconnect=${handle.shouldReconnect}, aborted=${signal.aborted})`
                  );

                  if (shouldReconnect && !handle.reconnecting) {
                    handle.reconnecting = true;
                    handle.reconnectTimeoutId = window.setTimeout(() => {
                      handle.reconnectTimeoutId = null;
                      if (signal.aborted) {
                        handle.reconnecting = false;
                        return;
                      }
                      connectRealtime(handle, source, sampleRate, signal)
                        .catch((err) => {
                          console.error(`Failed to reconnect ${source} realtime:`, err);
                        })
                        .finally(() => {
                          handle.reconnecting = false;
                        });
                    }, REALTIME_RETRY_DELAY_MS);
                  }
                  return;
                }

                const reason =
                  closeEvent?.reason || handle.errorLabel || "No reason provided";
                settleReject(
                  `Failed to open ${source} realtime stream at ${candidateBaseUri}: ${closeEvent?.code ?? "unknown"} - ${reason}${openResolved && !sessionResolved ? " (closed before session_started)" : ""}`
                );
              });
            });

            return;
          } catch (openError) {
            const message =
              openError instanceof Error
                ? openError.message
                : "Realtime connection attempt failed";

            const shouldRetryUnexpectedSocketClose =
              signal.aborted === false &&
              message.includes("WebSocket closed unexpectedly:");

            if (shouldRetryUnexpectedSocketClose) {
              console.warn(
                `[SystemAudio][${source}] open attempt ${attempt}/${REALTIME_MAX_CONNECT_ATTEMPTS} failed with transient close: ${message}`
              );
            }

            lastOpenError = message;
            handle.errorLabel = message;
            handle.ready = false;

            if (attempt < REALTIME_MAX_CONNECT_ATTEMPTS) {
              await new Promise((resolve) =>
                window.setTimeout(resolve, REALTIME_RETRY_DELAY_MS)
              );
            }
          }
        }
      }

      const fallbackMessage =
        lastOpenError ||
        `Failed to connect ${source} realtime stream after trying all endpoints.`;
      throw new Error(fallbackMessage);
    },
    [
      applySegmentUpdate,
      appendCommittedTranscript,
      appendLiveTranscript,
      commitLiveSegmentOnSpeakerSwitch,
      closeRealtimeHandle,
      flushRealtimeQueue,
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
      const hasAccess = await invoke<boolean>("check_system_audio_access");
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
      await invoke<string>("stop_system_audio_capture");
      await waitForBackendCaptureState(false);

      for (let attempt = 1; attempt <= SYSTEM_AUDIO_START_RETRY_LIMIT; attempt++) {
        try {
          await invoke<string>("start_system_audio_capture", {
            vadConfig,
            deviceId,
          });

          const started = await waitForBackendCaptureState(true);
          if (!started) {
            throw new Error("Backend capture did not enter running state in time.");
          }

          break;
        } catch (startSystemAudioError) {
          const message = toErrorMessage(startSystemAudioError);
          console.warn(
            `[SystemAudio] start_system_audio_capture attempt ${attempt}/${SYSTEM_AUDIO_START_RETRY_LIMIT} failed: ${message}`
          );

          if (
            !isCaptureAlreadyRunningError(startSystemAudioError) ||
            attempt >= SYSTEM_AUDIO_START_RETRY_LIMIT
          ) {
            throw startSystemAudioError;
          }

          await invoke<string>("stop_system_audio_capture").catch(() => {
            // no-op
          });

          await wait(SYSTEM_AUDIO_START_RETRY_DELAY_MS * attempt);
        }
      }
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

      await invoke<string>("stop_system_audio_capture");
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
    const commitHandle = (handle: RealtimeHandle, source: TranscriptSource): boolean => {
      if (!handle.connection || !handle.ready) {
        return false;
      }

      if (handle.uncommittedAudioMs < REALTIME_MIN_COMMIT_AUDIO_MS) {
        return false;
      }

      try {
        handle.connection.commit();
        handle.uncommittedAudioMs = 0;
        return true;
      } catch (commitError) {
        console.warn(`[SystemAudio][${source}] failed to commit stream:`, commitError);
        return false;
      }
    };

    const interviewer = interviewerRealtimeRef.current;
    const user = userRealtimeRef.current;

    if (commitHandle(interviewer, "interviewer")) {
      const preview = latestPartialInterviewerRef.current.trim();
      if (preview) {
        pendingCommitEchoRef.current.interviewer = {
          partialText: preview,
          timestamp: Date.now(),
        };
      }
    }

    if (commitHandle(user, "user")) {
      const preview = latestPartialUserRef.current.trim();
      if (preview) {
        pendingCommitEchoRef.current.user = {
          partialText: preview,
          timestamp: Date.now(),
        };
      }
    }
  }, [latestPartialInterviewerRef, latestPartialUserRef]);

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
  }, [capturing, setupRequired, error, isAIProcessing, lastAIResponse]);

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
      closeRealtimeSystems("unmount");
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
