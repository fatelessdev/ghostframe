import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useApp } from "@/contexts";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import {
  fetchAIResponse,
  compressImagePayloadInWorker,
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
  type AIImagePayload,
  type TranscriptSegment,
  type TranscriptStability,
  type TranscriptSource,
} from "@/types";
import { normalizeTranscription } from "@/lib/utils";
import {
  commitSegment,
  mergeTranscriptForPrompt,
  replaceLatestCommittedSegment,
  replaceLatestCommittedSegmentIfRecent,
  replaceLatestPendingCommittedSegment,
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
import {
  connectSystemAudioRealtime,
  type RealtimeCommittedTranscript,
} from "@/hooks/internal/systemAudioConnection";
import {
  appendManualScreenshot,
  buildImagesPayload as buildImagesPayloadInternal,
  clearManualScreenshotsState,
  createPendingManualScreenshot,
  resolveManualScreenshot,
  type ManualScreenshot,
} from "@/hooks/internal/systemAudioScreenshots";
import {
  commitLatestPartialTranscripts,
  commitRealtimeStreamsForAnswerTrigger,
  type PendingCommitEcho,
} from "@/hooks/internal/systemAudioAnswerTrigger";

type RequestPreparedMeta = {
  requestMethod: string;
  requestBodyChars: number;
  urlHost: string | null;
  urlPath: string | null;
  usedWorkerAssembly: boolean;
};

type QueueDepthHistogram = {
  empty: number;
  low: number;
  medium: number;
  high: number;
  saturated: number;
};

const createEmptyQueueDepthHistogram = (): QueueDepthHistogram => ({
  empty: 0,
  low: 0,
  medium: 0,
  high: 0,
  saturated: 0,
});

const bucketQueueDepth = (depth: number): keyof QueueDepthHistogram => {
  if (depth <= 0) {
    return "empty";
  }

  if (depth <= 5) {
    return "low";
  }

  if (depth <= 15) {
    return "medium";
  }

  if (depth <= 30) {
    return "high";
  }

  return "saturated";
};

type SystemAudioLogParams = {
  outcome: "success" | "error";
  errorMessage?: string;
  prompt: string;
  images: AIImagePayload[];
  previousMessages: { role: ChatMessage["role"]; content: string }[];
  providerId: string;
  aiMode: "D" | "P";
  requestAttempts: number;
  audioRoutingMeta: {
    inputDeviceId: string | null;
    inputDeviceName: string | null;
    outputDeviceId: string | null;
    outputDeviceName: string | null;
  };
  transcriptMeta: {
    segmentCount: number;
    committedCount: number;
    liveCount: number;
    interimCount: number;
    pendingCount: number;
    finalCount: number;
    pendingEchoSources: TranscriptSource[];
    latestPartialInterviewerChars: number;
    latestPartialUserChars: number;
  };
  streamStats: {
    queuePeakInterviewer: number;
    queuePeakUser: number;
    queueDepthHistogramInterviewer: QueueDepthHistogram;
    queueDepthHistogramUser: QueueDepthHistogram;
    droppedInterviewer: number;
    droppedUser: number;
    reconnectScheduled: number;
    reconnectOpened: number;
    reconnectDelayMsSamples: number[];
    wsEvents: number;
    wsEventsInterviewer: number;
    wsEventsUser: number;
    triggerQueued: number;
    triggerReplaced: number;
    triggerDropped: number;
    triggerAbortRequested: number;
    idlePromotedInterviewer: number;
    idlePromotedUser: number;
  };
};

const durationBetween = (
  start: number | undefined,
  end: number | undefined
): number | null => {
  if (typeof start !== "number" || typeof end !== "number") {
    return null;
  }

  const duration = end - start;
  if (!Number.isFinite(duration) || duration < 0) {
    return null;
  }

  return Math.round(duration);
};

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
const SCREENSHOT_COMPRESS_MAX_SIZE_MB = 0.4;
const SCREENSHOT_COMPRESS_MAX_WIDTH = 1600;
const SCREENSHOT_COMPRESS_INITIAL_QUALITY = 0.82;
const SCREENSHOT_COMPRESS_MIN_REDUCTION_RATIO = 0.08;
const MAX_SEND_LOCKS = 3;
const INTERIM_IDLE_PROMOTION_MS = 900;
const COMMITTED_REFINEMENT_MAX_AGE_MS = 12000;
const TRANSCRIPT_CLEAR_COMMIT_SUPPRESSION_MS = 450;
const ENGLISH_TRANSCRIPT_LANGUAGE_CODES = new Set(["en", "eng"]);
const ALLOWED_INTERVIEW_LANGUAGE_CODES = new Set(["en", "eng", "hi", "hin"]);
const NON_LATIN_TRANSCRIPT_PATTERN =
  /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}\p{N}\s]/u;
const ENGLISH_TRANSCRIPT_TRANSLATION_SYSTEM_PROMPT =
  "Translate short interview transcript snippets into natural English. Output only the final English transcript text, preserve names, numbers, technical terms, and intent, and never include any non-English script or extra commentary.";

const normalizeTranscriptLanguageCode = (
  value: string | null | undefined
): string | null => {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
};

const shouldHideTranscriptFromUi = (text: string): boolean => {
  return NON_LATIN_TRANSCRIPT_PATTERN.test(text);
};

const shouldTranslateCommittedTranscript = (
  text: string,
  languageCode: string | null
): boolean => {
  const normalizedLanguageCode = normalizeTranscriptLanguageCode(languageCode);
  if (normalizedLanguageCode && !ENGLISH_TRANSCRIPT_LANGUAGE_CODES.has(normalizedLanguageCode)) {
    return true;
  }

  return shouldHideTranscriptFromUi(text);
};

type ActiveAnswerSendLock = {
  id: number;
  triggerTs: number;
  typedInstruction: string;
  segments: TranscriptSegment[];
  prompt: string;
  requestDispatched: boolean;
};

const composePromptWithInstruction = (
  transcriptPrompt: string,
  typedInstruction: string
): string => {
  const trimmedPrompt = transcriptPrompt.trim();
  const trimmedInstruction = typedInstruction.trim();

  if (!trimmedInstruction) {
    return trimmedPrompt;
  }

  return trimmedPrompt
    ? `${trimmedPrompt}\n\nInstruction: ${trimmedInstruction}`
    : trimmedInstruction;
};

const buildTailoringPromptBlock = (
  tailoringEnabled: boolean,
  resumeSummary: string,
  jobDescriptionSummary: string
): string => {
  if (!tailoringEnabled) {
    return "";
  }

  const trimmedResumeSummary = resumeSummary.trim();
  const trimmedJobDescriptionSummary = jobDescriptionSummary.trim();
  if (!trimmedResumeSummary && !trimmedJobDescriptionSummary) {
    return "";
  }

  const sections: string[] = [];
  if (trimmedResumeSummary) {
    sections.push(`[USER_RESUME_SUMMARY]\n${trimmedResumeSummary}`);
  }

  if (trimmedJobDescriptionSummary) {
    sections.push(`[TARGET_JOB_SUMMARY]\n${trimmedJobDescriptionSummary}`);
  }

  sections.push(
    "Tailor responses using this profile context so wording, examples, and experience claims stay authentic and role-specific."
  );

  return sections.join("\n\n");
};

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
  answerTriggerToTranscriptFinalizedMs: createEmptyLatencyMetric(),
  transcriptFinalizedToPromptMs: createEmptyLatencyMetric(),
  answerTriggerToPromptMs: createEmptyLatencyMetric(),
  promptToDispatchMs: createEmptyLatencyMetric(),
  dispatchToFirstChunkMs: createEmptyLatencyMetric(),
  answerTriggerToFirstChunkMs: createEmptyLatencyMetric(),
  answerTriggerToDoneMs: createEmptyLatencyMetric(),
  promptToFirstChunkMs: createEmptyLatencyMetric(),
  firstChunkToDoneMs: createEmptyLatencyMetric(),
});

const createEmptyLatencySamples = (): Record<string, number[]> => ({
  answerTriggerToTranscriptFinalizedMs: [],
  transcriptFinalizedToPromptMs: [],
  answerTriggerToPromptMs: [],
  promptToDispatchMs: [],
  dispatchToFirstChunkMs: [],
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
  const queuedAnswerTriggerRef = useRef<{ typedInstruction: string } | null>(null);
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const transcriptFlushFrameRef = useRef<number | null>(null);
  const interimPromotionTimeoutRef = useRef<
    Partial<Record<TranscriptSource, number>>
  >({});
  const latestPartialInterviewerRef = useRef<string>("");
  const latestPartialUserRef = useRef<string>("");
  const pendingCommitEchoRef = useRef<
    Partial<Record<TranscriptSource, PendingCommitEcho>>
  >({});
  const suppressCommittedTranscriptUntilRef = useRef<
    Partial<Record<TranscriptSource, number>>
  >({});
  const activeAnswerSendLocksRef = useRef<ActiveAnswerSendLock[]>([]);
  const answerSendLockSeqRef = useRef(0);
  const aiResponseFlushFrameRef = useRef<number | null>(null);
  const aiResponseBufferRef = useRef("");
  const pipelineBusyRef = useRef(false);
  const latencyEventsRef = useRef<Partial<Record<SystemAudioLatencyStage, number>>>({});
  const latencySamplesRef = useRef<Record<string, number[]>>(
    createEmptyLatencySamples()
  );
  const wsBoundaryLastMarkedAtRef = useRef(0);
  const lastRealtimeWsReceivedAtRef = useRef<number | null>(null);
  const queueDepthPeakRef = useRef<Partial<Record<TranscriptSource, number>>>({});
  const queueDepthHistogramRef = useRef<
    Partial<Record<TranscriptSource, QueueDepthHistogram>>
  >({});
  const droppedChunksAtStartRef = useRef<Partial<Record<TranscriptSource, number>>>({});
  const reconnectScheduledCountRef = useRef(0);
  const reconnectOpenedCountRef = useRef(0);
  const reconnectDelaySamplesRef = useRef<number[]>([]);
  const wsEventsCountRef = useRef(0);
  const wsEventsBySourceRef = useRef<Partial<Record<TranscriptSource, number>>>({});
  const triggerQueuedCountRef = useRef(0);
  const triggerReplacedCountRef = useRef(0);
  const triggerDroppedCountRef = useRef(0);
  const triggerAbortRequestedCountRef = useRef(0);
  const idlePromotedCountRef = useRef<Partial<Record<TranscriptSource, number>>>({});

  const manualScreenshotsRef = useRef<ManualScreenshot[]>([]);
  const pendingScreenshotCaptureCountRef = useRef(0);
  const processingScreenshotQueueRef = useRef(false);
  const pendingTranscriptTranslationsRef = useRef<Set<Promise<void>>>(new Set());
  const transcriptMutationSessionRef = useRef(0);

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

  const processedManualScreenshotsCount = useMemo(() => {
    return manualScreenshots.reduce((count, screenshot) => {
      if (screenshot.status === "ready" && screenshot.image) {
        return count + 1;
      }

      return count;
    }, 0);
  }, [manualScreenshots]);

  const pendingManualScreenshotsCount = useMemo(() => {
    return manualScreenshots.length - processedManualScreenshotsCount;
  }, [manualScreenshots.length, processedManualScreenshotsCount]);

  const lastCommittedPrompt = useMemo(() => {
    return mergeTranscriptForPrompt(segments);
  }, [segments]);

  const quickActions = settings.quickActions;
  const useSystemPrompt = settings.useSystemPrompt;
  const contextContent = settings.contextContent;
  const tailoringEnabled = settings.tailoringEnabled;
  const resumeSummary = settings.resumeSummary;
  const jobDescriptionSummary = settings.jobDescriptionSummary;
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

  const getSelectedAiProviderConfig = useCallback(() => {
    if (!selectedAIProvider.provider) {
      return null;
    }

    const provider = allAiProviders.find(
      (entry) => entry.id === selectedAIProvider.provider
    );
    if (!provider) {
      return null;
    }

    return {
      provider,
      selectedProvider: selectedAIProvider,
    };
  }, [allAiProviders, selectedAIProvider]);

  const trackPendingTranscriptTranslation = useCallback((task: Promise<void>) => {
    pendingTranscriptTranslationsRef.current.add(task);
    void task.finally(() => {
      pendingTranscriptTranslationsRef.current.delete(task);
    });
  }, []);

  const waitForPendingTranscriptTranslations = useCallback(async () => {
    const pendingTranslations = Array.from(pendingTranscriptTranslationsRef.current);
    if (pendingTranslations.length === 0) {
      return;
    }

    await Promise.allSettled(pendingTranslations);
  }, []);

  const translateTranscriptToEnglish = useCallback(
    async (text: string, languageCode: string | null): Promise<string> => {
      const normalizedText = normalizeTranscription(text).trim();
      if (!normalizedText) {
        return "";
      }

      const providerConfig = getSelectedAiProviderConfig();
      if (!providerConfig) {
        return normalizedText;
      }

      const normalizedLanguageCode = normalizeTranscriptLanguageCode(languageCode);
      const translationPrompt = normalizedLanguageCode
        ? `Detected language: ${normalizedLanguageCode}\nTranscript: ${normalizedText}`
        : `Transcript: ${normalizedText}`;

      let translatedText = "";
      for await (const chunk of fetchAIResponse({
        provider: providerConfig.provider,
        selectedProvider: providerConfig.selectedProvider,
        systemPrompt: ENGLISH_TRANSCRIPT_TRANSLATION_SYSTEM_PROMPT,
        history: [],
        userMessage: translationPrompt,
        aiMode: currentAIMode,
      })) {
        translatedText += chunk;
      }

      return normalizeTranscription(translatedText).trim() || normalizedText;
    },
    [currentAIMode, getSelectedAiProviderConfig]
  );

  const getEffectiveSystemPrompt = useCallback(() => {
    const basePrompt = useSystemPrompt
      ? systemPrompt || DEFAULT_SYSTEM_PROMPT
      : contextContent.trim() || DEFAULT_SYSTEM_PROMPT;
    const tailoringBlock = buildTailoringPromptBlock(
      tailoringEnabled,
      resumeSummary,
      jobDescriptionSummary
    );

    if (!tailoringBlock) {
      return basePrompt;
    }

    return `${basePrompt}\n\n${tailoringBlock}`;
  }, [
    contextContent,
    jobDescriptionSummary,
    resumeSummary,
    systemPrompt,
    tailoringEnabled,
    useSystemPrompt,
  ]);

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

  const clearInterimPromotionTimeout = useCallback((source: TranscriptSource) => {
    const timeoutId = interimPromotionTimeoutRef.current[source];
    if (typeof timeoutId === "number") {
      window.clearTimeout(timeoutId);
      interimPromotionTimeoutRef.current[source] = undefined;
    }
  }, []);

  const clearAllInterimPromotionTimeouts = useCallback(() => {
    clearInterimPromotionTimeout("interviewer");
    clearInterimPromotionTimeout("user");
  }, [clearInterimPromotionTimeout]);

  const clearPendingRealtimeState = useCallback(() => {
    clearAllInterimPromotionTimeouts();
    latestPartialInterviewerRef.current = "";
    latestPartialUserRef.current = "";
    pendingCommitEchoRef.current = {};
    suppressCommittedTranscriptUntilRef.current = {};
    activeAnswerSendLocksRef.current = [];
  }, [clearAllInterimPromotionTimeouts]);

  const retainPendingCommitEchoAfter = useCallback((cutoffTs: number) => {
    const nextPending: Partial<Record<TranscriptSource, PendingCommitEcho>> = {};

    const interviewerPending = pendingCommitEchoRef.current.interviewer;
    if (interviewerPending && interviewerPending.timestamp > cutoffTs) {
      nextPending.interviewer = interviewerPending;
    }

    const userPending = pendingCommitEchoRef.current.user;
    if (userPending && userPending.timestamp > cutoffTs) {
      nextPending.user = userPending;
    }

    pendingCommitEchoRef.current = nextPending;
  }, []);

  const cleanupAfterSuccessfulDispatch = useCallback(
    (retainCutoffTs: number) => {
      applySegmentUpdate((previous) => retainUnsentSegments(previous, retainCutoffTs));
      retainPendingCommitEchoAfter(retainCutoffTs);
      setManualScreenshots((previous) => {
        return clearManualScreenshotsState(previous, manualScreenshotsRef);
      });
    },
    [applySegmentUpdate, retainPendingCommitEchoAfter]
  );

  const resetInterviewState = useCallback(() => {
    transcriptMutationSessionRef.current += 1;
    pendingTranscriptTranslationsRef.current.clear();
    applySegmentUpdate(() => []);
    clearPendingRealtimeState();
  }, [applySegmentUpdate, clearPendingRealtimeState]);

  const suppressCommittedTranscriptEcho = useCallback(
    (durationMs: number = TRANSCRIPT_CLEAR_COMMIT_SUPPRESSION_MS) => {
      const normalizedDuration = Math.max(0, Math.round(durationMs));
      const until = Date.now() + normalizedDuration;
      suppressCommittedTranscriptUntilRef.current = {
        interviewer: until,
        user: until,
      };
    },
    []
  );

  const appendLiveTranscript = useCallback(
    (source: TranscriptSource, text: string) => {
      applySegmentUpdate((previous) => replaceLiveSegment(previous, source, text));
      clearInterimPromotionTimeout(source);

      const timeoutId = window.setTimeout(() => {
        interimPromotionTimeoutRef.current[source] = undefined;

        const latestPartialText =
          source === "interviewer"
            ? latestPartialInterviewerRef.current.trim()
            : latestPartialUserRef.current.trim();
        if (!latestPartialText) {
          return;
        }

        let promoted = false;
        applySegmentUpdate((previous) => {
          const updated = commitSegment(previous, source, latestPartialText, "optimistic");
          if (updated !== previous) {
            promoted = true;
          }
          return updated;
        });

        if (!promoted) {
          return;
        }

        pendingCommitEchoRef.current[source] = {
          partialText: latestPartialText,
          timestamp: Date.now(),
        };

        idlePromotedCountRef.current[source] =
          (idlePromotedCountRef.current[source] || 0) + 1;
      }, INTERIM_IDLE_PROMOTION_MS);

      interimPromotionTimeoutRef.current[source] = timeoutId;
    },
    [applySegmentUpdate, clearInterimPromotionTimeout]
  );

  const appendCommittedTranscript = useCallback(
    (
      source: TranscriptSource,
      text: string,
      stability: TranscriptStability = "final",
      timestamp: number = Date.now()
    ) => {
      if (stability === "final") {
        clearInterimPromotionTimeout(source);
      }
      applySegmentUpdate((previous) =>
        commitSegment(previous, source, text, stability, timestamp)
      );
    },
    [applySegmentUpdate, clearInterimPromotionTimeout]
  );

  const clearLiveTranscript = useCallback(
    (source: TranscriptSource) => {
      applySegmentUpdate((previous) => commitSegment(previous, source, "", "final"));
    },
    [applySegmentUpdate]
  );

  const createAnswerSendLock = useCallback(
    (typedInstruction: string, triggerTs: number): ActiveAnswerSendLock | null => {
      if (!capturing) {
        return null;
      }

      const lockedSegments = segmentsRef.current
        .filter((segment) => !segment.isLive && segment.timestamp <= triggerTs)
        .map((segment) => ({ ...segment }));
      const transcriptPrompt = mergeTranscriptForPrompt(lockedSegments, triggerTs);
      const prompt = composePromptWithInstruction(transcriptPrompt, typedInstruction);

      if (!prompt.trim()) {
        return null;
      }

      const lock: ActiveAnswerSendLock = {
        id: ++answerSendLockSeqRef.current,
        triggerTs,
        typedInstruction: typedInstruction.trim(),
        segments: lockedSegments,
        prompt: prompt.trim(),
        requestDispatched: false,
      };

      activeAnswerSendLocksRef.current = [
        ...activeAnswerSendLocksRef.current.slice(-Math.max(0, MAX_SEND_LOCKS - 1)),
        lock,
      ];

      return lock;
    },
    [capturing]
  );

  const markAnswerSendLockDispatched = useCallback((lockId: number) => {
    activeAnswerSendLocksRef.current = activeAnswerSendLocksRef.current.map((lock) => {
      if (lock.id !== lockId) {
        return lock;
      }

      return {
        ...lock,
        requestDispatched: true,
      };
    });
  }, []);

  const removeAnswerSendLock = useCallback((lockId: number) => {
    activeAnswerSendLocksRef.current = activeAnswerSendLocksRef.current.filter(
      (lock) => lock.id !== lockId
    );
  }, []);

  const patchAnswerSendLocks = useCallback(
    (source: TranscriptSource, previousText: string, nextText: string) => {
      if (!nextText.trim()) {
        return;
      }

      const hasPreviousText = previousText.trim().length > 0;
      let changed = false;

      const nextLocks = activeAnswerSendLocksRef.current.map((lock) => {
        if (lock.requestDispatched) {
          return lock;
        }

        const replacedSegments = hasPreviousText
          ? replaceLatestCommittedSegment(
              lock.segments,
              source,
              previousText,
              nextText,
              "final"
            )
          : null;

        const fallbackReplacedSegments = hasPreviousText
          ? replaceLatestPendingCommittedSegment(lock.segments, source, nextText, "final")
          : null;

        const recentReplacedSegments = hasPreviousText
          ? null
          : replaceLatestCommittedSegmentIfRecent(
              lock.segments,
              source,
              nextText,
              8000,
              "final"
            );

        const patchedSegments =
          replacedSegments ||
          fallbackReplacedSegments ||
          recentReplacedSegments ||
          commitSegment(lock.segments, source, nextText, "final");

        const patchedPrompt = composePromptWithInstruction(
          mergeTranscriptForPrompt(patchedSegments, lock.triggerTs),
          lock.typedInstruction
        ).trim();

        if (patchedPrompt === lock.prompt) {
          return lock;
        }

        changed = true;
        return {
          ...lock,
          segments: patchedSegments,
          prompt: patchedPrompt,
        };
      });

      if (changed) {
        activeAnswerSendLocksRef.current = nextLocks;
      }
    },
    []
  );

  const applyCommittedTranscriptUpdate = useCallback(
    (
      source: TranscriptSource,
      rawText: string,
      committedAt: number = Date.now()
    ) => {
      const text = normalizeTranscription(rawText).trim();
      if (!text) {
        return;
      }

      clearInterimPromotionTimeout(source);
      const pending = pendingCommitEchoRef.current[source];
      const suppressedUntil = suppressCommittedTranscriptUntilRef.current[source] || 0;
      if (!pending && suppressedUntil > Date.now()) {
        return;
      }
      suppressCommittedTranscriptUntilRef.current[source] = 0;

      setError("");
      if (pending) {
        const replaced = replaceLatestCommittedSegment(
          segmentsRef.current,
          source,
          pending.partialText,
          text,
          "final",
          committedAt
        );
        if (replaced) {
          applySegmentUpdate(() => replaced);
        } else {
          const fallbackReplaced = replaceLatestPendingCommittedSegment(
            segmentsRef.current,
            source,
            text,
            "final",
            committedAt
          );
          if (fallbackReplaced) {
            applySegmentUpdate(() => fallbackReplaced);
          } else {
            const recentReplaced = replaceLatestCommittedSegmentIfRecent(
              segmentsRef.current,
              source,
              text,
              COMMITTED_REFINEMENT_MAX_AGE_MS,
              "final",
              committedAt
            );

            if (recentReplaced) {
              applySegmentUpdate(() => recentReplaced);
            } else {
              appendCommittedTranscript(source, text, "final", committedAt);
            }
          }
        }
        patchAnswerSendLocks(source, pending.partialText, text);
        pendingCommitEchoRef.current[source] = undefined;
        return;
      }

      const recentReplaced = replaceLatestCommittedSegmentIfRecent(
        segmentsRef.current,
        source,
        text,
        COMMITTED_REFINEMENT_MAX_AGE_MS,
        "final",
        committedAt
      );
      if (recentReplaced) {
        applySegmentUpdate(() => recentReplaced);
        patchAnswerSendLocks(source, "", text);
        return;
      }

      appendCommittedTranscript(source, text, "final", committedAt);
      patchAnswerSendLocks(source, "", text);
    },
    [
      appendCommittedTranscript,
      applySegmentUpdate,
      clearInterimPromotionTimeout,
      patchAnswerSendLocks,
    ]
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

      appendCommittedTranscript(interruptedSource, interruptedText, "optimistic");
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
      wsEventsCountRef.current += 1;
      wsEventsBySourceRef.current[handle.label] =
        (wsEventsBySourceRef.current[handle.label] || 0) + 1;
      const wsMarkNow = Date.now();
      lastRealtimeWsReceivedAtRef.current = wsMarkNow;
      if (wsMarkNow - wsBoundaryLastMarkedAtRef.current > 120) {
        wsBoundaryLastMarkedAtRef.current = wsMarkNow;
        latencyEventsRef.current.realtime_ws_received = wsMarkNow;
      }

      const droppedBefore = handle.droppedQueueChunks;
      sendRealtimeChunkInternal(handle, chunk, REALTIME_QUEUE_LIMIT);

      const queueDepth = Math.max(0, handle.queue.length - handle.queueHead);
      const previousPeak = queueDepthPeakRef.current[handle.label] || 0;
      if (queueDepth > previousPeak) {
        queueDepthPeakRef.current[handle.label] = queueDepth;
      }

      const sourceHistogram =
        queueDepthHistogramRef.current[handle.label] || createEmptyQueueDepthHistogram();
      const queueDepthBucket = bucketQueueDepth(queueDepth);
      sourceHistogram[queueDepthBucket] += 1;
      queueDepthHistogramRef.current[handle.label] = sourceHistogram;

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

      const transcriptFinalizedAt = latencyEventsRef.current.transcript_finalized;
      const promptAt = latencyEventsRef.current.prompt_assembled;
      const dispatchedAt = latencyEventsRef.current.llm_request_dispatched;
      const firstChunkAt = latencyEventsRef.current.llm_first_chunk;
      const doneAt = latencyEventsRef.current.llm_stream_done;

      const nextSamples: Record<string, number[]> = {
        answerTriggerToTranscriptFinalizedMs: [
          ...latencySamplesRef.current.answerTriggerToTranscriptFinalizedMs,
        ],
        transcriptFinalizedToPromptMs: [
          ...latencySamplesRef.current.transcriptFinalizedToPromptMs,
        ],
        answerTriggerToPromptMs: [...latencySamplesRef.current.answerTriggerToPromptMs],
        promptToDispatchMs: [...latencySamplesRef.current.promptToDispatchMs],
        dispatchToFirstChunkMs: [...latencySamplesRef.current.dispatchToFirstChunkMs],
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

      if (stage === "transcript_finalized" && transcriptFinalizedAt) {
        pushSample(
          "answerTriggerToTranscriptFinalizedMs",
          transcriptFinalizedAt - answerTriggerAt
        );
      }

      if (stage === "prompt_assembled" && promptAt) {
        pushSample("answerTriggerToPromptMs", promptAt - answerTriggerAt);
        if (transcriptFinalizedAt) {
          pushSample(
            "transcriptFinalizedToPromptMs",
            promptAt - transcriptFinalizedAt
          );
        }
      }

      if (stage === "llm_request_dispatched" && dispatchedAt) {
        if (promptAt) {
          pushSample("promptToDispatchMs", dispatchedAt - promptAt);
        }
      }

      if (stage === "llm_first_chunk" && firstChunkAt) {
        pushSample("answerTriggerToFirstChunkMs", firstChunkAt - answerTriggerAt);
        if (promptAt) {
          pushSample("promptToFirstChunkMs", firstChunkAt - promptAt);
        }
        if (dispatchedAt) {
          pushSample("dispatchToFirstChunkMs", firstChunkAt - dispatchedAt);
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
        nextSamples.answerTriggerToTranscriptFinalizedMs.length,
        nextSamples.transcriptFinalizedToPromptMs.length,
        nextSamples.answerTriggerToPromptMs.length,
        nextSamples.promptToDispatchMs.length,
        nextSamples.dispatchToFirstChunkMs.length,
        nextSamples.answerTriggerToFirstChunkMs.length,
        nextSamples.answerTriggerToDoneMs.length,
        nextSamples.promptToFirstChunkMs.length,
        nextSamples.firstChunkToDoneMs.length
      );

      setLatencySnapshot({
        startedAt: answerTriggerAt,
        sampleCount,
        answerTriggerToTranscriptFinalizedMs: buildLatencyMetric(
          nextSamples.answerTriggerToTranscriptFinalizedMs
        ),
        transcriptFinalizedToPromptMs: buildLatencyMetric(
          nextSamples.transcriptFinalizedToPromptMs
        ),
        answerTriggerToPromptMs: buildLatencyMetric(
          nextSamples.answerTriggerToPromptMs
        ),
        promptToDispatchMs: buildLatencyMetric(nextSamples.promptToDispatchMs),
        dispatchToFirstChunkMs: buildLatencyMetric(
          nextSamples.dispatchToFirstChunkMs
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

  const captureManualScreenshot = useCallback(async () => {
    const pending = createPendingManualScreenshot();
    setManualScreenshots((previous) => {
      const next = appendManualScreenshot(previous, pending, maxManualScreenshots);
      manualScreenshotsRef.current = next;
      return next;
    });

    try {
      const captured = await tauriCommands.captureToImagePayload();
      let image = captured;

      try {
        image = await compressImagePayloadInWorker(captured, {
          maxSizeMB: SCREENSHOT_COMPRESS_MAX_SIZE_MB,
          maxWidthOrHeight: SCREENSHOT_COMPRESS_MAX_WIDTH,
          initialQuality: SCREENSHOT_COMPRESS_INITIAL_QUALITY,
          outputMimeType: "image/webp",
          minReductionRatio: SCREENSHOT_COMPRESS_MIN_REDUCTION_RATIO,
        });
      } catch (compressError) {
        console.warn("Worker screenshot compression failed; using captured image:", compressError);
      }

      const resolved = resolveManualScreenshot(pending, image);
      setManualScreenshots((previous) => {
        const next = previous.map((item) => {
          if (item.id !== pending.id) {
            return item;
          }

          return resolved;
        });
        manualScreenshotsRef.current = next;
        return next;
      });
    } catch (captureError) {
      console.error("Manual screenshot capture failed:", captureError);
      setManualScreenshots((previous) => {
        const next = previous.filter((item) => item.id !== pending.id);
        manualScreenshotsRef.current = next;
        return next;
      });
      setError("Failed to capture screenshot");
    }
  }, [maxManualScreenshots]);

  const processManualScreenshotQueue = useCallback(async () => {
    if (processingScreenshotQueueRef.current) {
      return;
    }

    processingScreenshotQueueRef.current = true;
    setIsCapturingScreenshot(true);

    try {
      while (pendingScreenshotCaptureCountRef.current > 0) {
        pendingScreenshotCaptureCountRef.current -= 1;
        await captureManualScreenshot();
      }
    } finally {
      processingScreenshotQueueRef.current = false;
      setIsCapturingScreenshot(false);

      if (pendingScreenshotCaptureCountRef.current > 0) {
        void processManualScreenshotQueue();
      }
    }
  }, [captureManualScreenshot]);

  const handleCaptureScreenshot = useCallback(async () => {
    pendingScreenshotCaptureCountRef.current += 1;
    await processManualScreenshotQueue();
  }, [processManualScreenshotQueue]);

  const removeManualScreenshot = useCallback((id: string) => {
    setManualScreenshots((previous) => {
      const next = previous.filter((item) => item.id !== id);
      manualScreenshotsRef.current = next;
      return next;
    });
  }, []);

  const buildImagesPayload = useCallback((): AIImagePayload[] => {
    return buildImagesPayloadInternal(manualScreenshotsRef.current);
  }, []);

  const writeSystemAudioLog = useCallback(
    async (
      params: SystemAudioLogParams,
      requestMeta: RequestPreparedMeta | null
    ) => {
      const events = latencyEventsRef.current;
      const answerTriggerAt = events.answer_trigger;
      const transcriptFinalizedAt = events.transcript_finalized;
      const promptAssembledAt = events.prompt_assembled;
      const requestDispatchedAt = events.llm_request_dispatched;
      const firstChunkAt = events.llm_first_chunk;
      const streamDoneAt = events.llm_stream_done;
      const errorAt = events.llm_error;

      const screenshotSizes = params.images.map((image) => image.base64.length);
      const screenshotMimeTypes = params.images.map((image) => image.mimeType);
      const totalImageChars = screenshotSizes.reduce((sum, size) => sum + size, 0);
      const historyChars = params.previousMessages.reduce(
        (sum, message) => sum + message.content.length,
        0
      );
      const droppedTotal =
        params.streamStats.droppedInterviewer + params.streamStats.droppedUser;
      const droppedRate =
        params.streamStats.wsEvents > 0
          ? droppedTotal / params.streamStats.wsEvents
          : 0;
      const droppedRateRounded = Math.round(droppedRate * 10000) / 10000;

      const entry = {
        timestamp: new Date().toISOString(),
        type: "system_audio_latency",
        outcome: params.outcome,
        error: params.errorMessage || null,
        providerId: params.providerId,
        aiMode: params.aiMode,
        promptText: params.prompt,
        timestamps: {
          answerTriggerAt: answerTriggerAt ?? null,
          transcriptFinalizedAt: transcriptFinalizedAt ?? null,
          promptAssembledAt: promptAssembledAt ?? null,
          requestDispatchedAt: requestDispatchedAt ?? null,
          firstChunkAt: firstChunkAt ?? null,
          streamDoneAt: streamDoneAt ?? null,
          errorAt: errorAt ?? null,
        },
        durationsMs: {
          wsReceiveToAnswerTrigger: durationBetween(
            events.realtime_ws_received,
            answerTriggerAt
          ),
          answerTriggerToTranscriptFinalized: durationBetween(
            answerTriggerAt,
            transcriptFinalizedAt
          ),
          transcriptFinalizedToPrompt: durationBetween(
            transcriptFinalizedAt,
            promptAssembledAt
          ),
          answerTriggerToPrompt: durationBetween(answerTriggerAt, promptAssembledAt),
          promptToDispatch: durationBetween(promptAssembledAt, requestDispatchedAt),
          dispatchToFirstChunk: durationBetween(requestDispatchedAt, firstChunkAt),
          firstChunkToDone: durationBetween(firstChunkAt, streamDoneAt),
          answerTriggerToDone: durationBetween(answerTriggerAt, streamDoneAt),
          answerTriggerToError: durationBetween(answerTriggerAt, errorAt),
        },
        payloadMeta: {
          transcriptChars: params.prompt.length,
          screenshotCount: screenshotSizes.length,
          screenshotMimeTypes,
          screenshotBase64Chars: screenshotSizes,
          totalScreenshotBase64Chars: totalImageChars,
          historyMessageCount: params.previousMessages.length,
          historyChars,
        },
        requestMeta: {
          method: requestMeta?.requestMethod ?? null,
          requestBodyChars: requestMeta?.requestBodyChars ?? null,
          urlHost: requestMeta?.urlHost ?? null,
          urlPath: requestMeta?.urlPath ?? null,
          workerAssembled: requestMeta?.usedWorkerAssembly ?? null,
          requestAttempts: params.requestAttempts,
        },
        streamMeta: {
          wsEvents: params.streamStats.wsEvents,
          wsEventsInterviewer: params.streamStats.wsEventsInterviewer,
          wsEventsUser: params.streamStats.wsEventsUser,
          queuePeakInterviewer: params.streamStats.queuePeakInterviewer,
          queuePeakUser: params.streamStats.queuePeakUser,
          queueDepthHistogramInterviewer:
            params.streamStats.queueDepthHistogramInterviewer,
          queueDepthHistogramUser: params.streamStats.queueDepthHistogramUser,
          droppedInterviewer: params.streamStats.droppedInterviewer,
          droppedUser: params.streamStats.droppedUser,
          droppedTotal,
          droppedRate: droppedRateRounded,
          reconnectScheduled: params.streamStats.reconnectScheduled,
          reconnectOpened: params.streamStats.reconnectOpened,
          reconnectDelayMsSamples: params.streamStats.reconnectDelayMsSamples,
          triggerQueued: params.streamStats.triggerQueued,
          triggerReplaced: params.streamStats.triggerReplaced,
          triggerDropped: params.streamStats.triggerDropped,
          triggerAbortRequested: params.streamStats.triggerAbortRequested,
          idlePromotedInterviewer: params.streamStats.idlePromotedInterviewer,
          idlePromotedUser: params.streamStats.idlePromotedUser,
          thresholdFlags: {
            queuePressureHigh:
              params.streamStats.queuePeakInterviewer >= 30 ||
              params.streamStats.queuePeakUser >= 30,
            droppedRateHigh: droppedRate >= 0.03,
            reconnectChurnHigh: params.streamStats.reconnectScheduled >= 2,
            triggerBurstHigh:
              params.streamStats.triggerQueued >= 2 ||
              params.streamStats.triggerReplaced >= 1,
          },
        },
        transcriptMeta: params.transcriptMeta,
        audioRoutingMeta: params.audioRoutingMeta,
      };

      try {
        await tauriCommands.appendSystemAudioLogLine(JSON.stringify(entry));
      } catch (logError) {
        console.warn("Failed to append system audio latency log:", logError);
      }
    },
    []
  );

  const collectStreamStats = useCallback(() => {
    return {
      queuePeakInterviewer: queueDepthPeakRef.current.interviewer || 0,
      queuePeakUser: queueDepthPeakRef.current.user || 0,
      queueDepthHistogramInterviewer: {
        ...createEmptyQueueDepthHistogram(),
        ...(queueDepthHistogramRef.current.interviewer || {}),
      },
      queueDepthHistogramUser: {
        ...createEmptyQueueDepthHistogram(),
        ...(queueDepthHistogramRef.current.user || {}),
      },
      droppedInterviewer: Math.max(
        0,
        interviewerRealtimeRef.current.droppedQueueChunks -
          (droppedChunksAtStartRef.current.interviewer || 0)
      ),
      droppedUser: Math.max(
        0,
        userRealtimeRef.current.droppedQueueChunks -
          (droppedChunksAtStartRef.current.user || 0)
      ),
      reconnectScheduled: reconnectScheduledCountRef.current,
      reconnectOpened: reconnectOpenedCountRef.current,
      reconnectDelayMsSamples: [...reconnectDelaySamplesRef.current],
      wsEvents: wsEventsCountRef.current,
      wsEventsInterviewer: wsEventsBySourceRef.current.interviewer || 0,
      wsEventsUser: wsEventsBySourceRef.current.user || 0,
      triggerQueued: triggerQueuedCountRef.current,
      triggerReplaced: triggerReplacedCountRef.current,
      triggerDropped: triggerDroppedCountRef.current,
      triggerAbortRequested: triggerAbortRequestedCountRef.current,
      idlePromotedInterviewer: idlePromotedCountRef.current.interviewer || 0,
      idlePromotedUser: idlePromotedCountRef.current.user || 0,
    };
  }, []);

  const collectTranscriptMeta = useCallback(() => {
    const currentSegments = segmentsRef.current;
    let committedCount = 0;
    let liveCount = 0;
    let interimCount = 0;
    let pendingCount = 0;
    let finalCount = 0;

    for (const segment of currentSegments) {
      if (segment.isLive) {
        liveCount += 1;
      } else {
        committedCount += 1;
      }

      const stability = segment.stability || (segment.isLive ? "interim" : "final");
      if (stability === "interim") {
        interimCount += 1;
      } else if (stability === "optimistic") {
        pendingCount += 1;
      } else {
        finalCount += 1;
      }
    }

    const pendingEchoSources = (["interviewer", "user"] as const).filter((source) => {
      return !!pendingCommitEchoRef.current[source];
    });

    return {
      segmentCount: currentSegments.length,
      committedCount,
      liveCount,
      interimCount,
      pendingCount,
      finalCount,
      pendingEchoSources,
      latestPartialInterviewerChars: latestPartialInterviewerRef.current.trim().length,
      latestPartialUserChars: latestPartialUserRef.current.trim().length,
    };
  }, []);

  const collectAudioRoutingMeta = useCallback(() => {
    return {
      inputDeviceId: selectedAudioDevices.input.id || null,
      inputDeviceName: selectedAudioDevices.input.name || null,
      outputDeviceId: selectedAudioDevices.output.id || null,
      outputDeviceName: selectedAudioDevices.output.name || null,
    };
  }, [
    selectedAudioDevices.input.id,
    selectedAudioDevices.input.name,
    selectedAudioDevices.output.id,
    selectedAudioDevices.output.name,
  ]);

  const consumeQueuedAnswerTrigger = useCallback((): string | null => {
    const queued = queuedAnswerTriggerRef.current;
    queuedAnswerTriggerRef.current = null;
    if (!queued) {
      return null;
    }

    return queued.typedInstruction;
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
    async (
      userMessage: string,
      images: AIImagePayload[],
      options?: {
        resolveUserMessage?: () => string;
        onRequestDispatched?: () => void;
      }
    ): Promise<boolean> => {
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
      const providerId =
        provider.id ?? selectedAIProvider.provider ?? "unknown";

      const getResolvedPrompt = () => {
        const resolved = options?.resolveUserMessage?.();
        if (typeof resolved === "string") {
          return resolved.trim();
        }

        return userMessage.trim();
      };

      const fullPrompt = getResolvedPrompt();
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
      let requestPreparedMeta: RequestPreparedMeta | null = null;
      droppedChunksAtStartRef.current = {
        interviewer: interviewerRealtimeRef.current.droppedQueueChunks,
        user: userRealtimeRef.current.droppedQueueChunks,
      };
      queueDepthPeakRef.current = {
        interviewer: 0,
        user: 0,
      };
      queueDepthHistogramRef.current = {
        interviewer: createEmptyQueueDepthHistogram(),
        user: createEmptyQueueDepthHistogram(),
      };
      reconnectScheduledCountRef.current = 0;
      reconnectOpenedCountRef.current = 0;
      reconnectDelaySamplesRef.current = [];
      wsEventsCountRef.current = 0;
      wsEventsBySourceRef.current = {
        interviewer: 0,
        user: 0,
      };
      triggerQueuedCountRef.current = 0;
      triggerReplacedCountRef.current = 0;
      triggerDroppedCountRef.current = 0;
      triggerAbortRequestedCountRef.current = 0;
      recordLatencyMark("prompt_assembled", Date.now());

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
      let requestDispatched = false;
      let requestAttempts = 0;
      try {
        for await (const chunk of fetchAIResponse({
          provider,
          selectedProvider: selectedAIProvider,
          systemPrompt: getEffectiveSystemPrompt(),
          history: previousMessages,
          userMessage: fullPrompt,
          resolveUserMessage: options?.resolveUserMessage,
          imagesBase64: images,
          aiMode: currentAIMode,
          signal: controller.signal,
          onRequestPrepared: (meta) => {
            requestPreparedMeta = meta;
          },
          onRequestDispatched: (attempt) => {
            requestAttempts = Math.max(requestAttempts, attempt);
            if (requestDispatched) {
              return;
            }

            requestDispatched = true;
            recordLatencyMark("llm_request_dispatched", Date.now());
            options?.onRequestDispatched?.();
          },
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

        if (requestAttempts === 0 && requestDispatched) {
          requestAttempts = 1;
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

        if (!options?.resolveUserMessage) {
          setManualScreenshots((previous) => {
            return clearManualScreenshotsState(previous, manualScreenshotsRef);
          });
        }
        recordLatencyMark("llm_stream_done", Date.now());

        await writeSystemAudioLog({
          outcome: "success",
          prompt: fullPrompt,
          images,
          previousMessages,
          providerId,
          aiMode: currentAIMode,
          requestAttempts,
          audioRoutingMeta: collectAudioRoutingMeta(),
          transcriptMeta: collectTranscriptMeta(),
          streamStats: collectStreamStats(),
        }, requestPreparedMeta);

        return true;
      } catch (aiError) {
        if (!controller.signal.aborted) {
          recordLatencyMark("llm_error", Date.now());
        }
        if (requestAttempts === 0 && requestDispatched) {
          requestAttempts = 1;
        }
        if (!controller.signal.aborted) {
          await writeSystemAudioLog({
            outcome: "error",
            errorMessage:
              aiError instanceof Error ? aiError.message : "Failed to generate AI response",
            prompt: fullPrompt,
            images,
            previousMessages,
            providerId,
            aiMode: currentAIMode,
            requestAttempts,
            audioRoutingMeta: collectAudioRoutingMeta(),
            transcriptMeta: collectTranscriptMeta(),
            streamStats: collectStreamStats(),
          }, requestPreparedMeta);
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
      collectStreamStats,
      collectTranscriptMeta,
      collectAudioRoutingMeta,
      recordLatencyMark,
      selectedAIProvider,
      writeSystemAudioLog,
    ]
  );

  const processPendingAnswer = useCallback(
    async (typedInstruction?: string): Promise<boolean> => {
      const trimmedInstruction = typedInstruction?.trim() ?? "";

      if (!capturing && !trimmedInstruction) {
        return false;
      }

      setIsProcessing(true);
      setError("");

      const triggerTs = Date.now();
      const lastRealtimeWsReceivedAt = lastRealtimeWsReceivedAtRef.current;
      latencyEventsRef.current = lastRealtimeWsReceivedAt
        ? {
            answer_trigger: triggerTs,
            realtime_ws_received: lastRealtimeWsReceivedAt,
          }
        : {
            answer_trigger: triggerTs,
          };
      recordLatencyMark("answer_trigger", triggerTs);
      clearAllInterimPromotionTimeouts();
      let sendLock: ActiveAnswerSendLock | null = null;

      try {
        let prompt = "";
        let retainCutoffTs = triggerTs;
        let dispatchCleanupApplied = false;

        const applyDispatchCleanup = () => {
          if (dispatchCleanupApplied || !capturing) {
            return;
          }

          dispatchCleanupApplied = true;
          cleanupAfterSuccessfulDispatch(retainCutoffTs);
        };

        if (capturing) {
          await waitForPendingTranscriptTranslations();
          sendLock = createAnswerSendLock(trimmedInstruction, triggerTs);
          if (!sendLock) {
            setIsProcessing(false);
            setError("No transcript available yet. Keep speaking and try again.");
            return false;
          }

          retainCutoffTs = sendLock.triggerTs;
          prompt = sendLock.prompt;
        } else {
          prompt = trimmedInstruction;
        }

        recordLatencyMark("transcript_finalized", Date.now());

        const images = buildImagesPayload();
        let sendLockOptions:
          | {
              resolveUserMessage: () => string;
              onRequestDispatched: () => void;
            }
          | undefined;
        if (sendLock) {
          const activeSendLock = sendLock;
          sendLockOptions = {
            resolveUserMessage: () => {
              const latestLock = activeAnswerSendLocksRef.current.find(
                (lock) => lock.id === activeSendLock.id
              );
              return latestLock?.prompt || activeSendLock.prompt;
            },
            onRequestDispatched: () => {
              markAnswerSendLockDispatched(activeSendLock.id);
              applyDispatchCleanup();
            },
          };
        }
        const sent = await runAI(
          prompt,
          images,
          sendLockOptions
        );
        if (sent && capturing && !dispatchCleanupApplied) {
          applyDispatchCleanup();
        }

        return sent;
      } finally {
        if (sendLock) {
          removeAnswerSendLock(sendLock.id);
        }
        setIsProcessing(false);
      }
    },
    [
      applySegmentUpdate,
      buildImagesPayload,
      capturing,
      cleanupAfterSuccessfulDispatch,
      clearAllInterimPromotionTimeouts,
      createAnswerSendLock,
      markAnswerSendLockDispatched,
      recordLatencyMark,
      removeAnswerSendLock,
      runAI,
      waitForPendingTranscriptTranslations,
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

          if (shouldHideTranscriptFromUi(text)) {
            clearInterimPromotionTimeout(source);
            clearLiveTranscript(source);

            if (source === "interviewer") {
              latestPartialInterviewerRef.current = "";
            } else {
              latestPartialUserRef.current = "";
            }
            return;
          }

          commitLiveSegmentOnSpeakerSwitch(source);
          setError("");
          suppressCommittedTranscriptUntilRef.current[source] = 0;

          if (source === "interviewer") {
            latestPartialInterviewerRef.current = text;
          } else {
            latestPartialUserRef.current = text;
          }

          appendLiveTranscript(source, text);
        },
        onCommittedTranscript: (payload: RealtimeCommittedTranscript) => {
          const text = normalizeTranscription(payload.text).trim();
          if (!text) {
            return;
          }
          const committedAt = Date.now();
          const languageCode = normalizeTranscriptLanguageCode(payload.languageCode);

          if (languageCode && !ALLOWED_INTERVIEW_LANGUAGE_CODES.has(languageCode)) {
            console.warn(
              `[SystemAudio][${source}] unexpected realtime transcript language: ${languageCode}`
            );
          }

          if (!shouldTranslateCommittedTranscript(text, languageCode)) {
            applyCommittedTranscriptUpdate(source, text, committedAt);
            return;
          }

          const translationSession = transcriptMutationSessionRef.current;
          const translationTask = (async () => {
            try {
              const translatedText = await translateTranscriptToEnglish(
                text,
                languageCode
              );

              if (translationSession !== transcriptMutationSessionRef.current) {
                return;
              }

              const normalizedTranslated = normalizeTranscription(translatedText).trim();
              if (!normalizedTranslated) {
                if (!shouldHideTranscriptFromUi(text)) {
                  applyCommittedTranscriptUpdate(source, text, committedAt);
                }
                return;
              }

              if (shouldHideTranscriptFromUi(normalizedTranslated)) {
                if (!shouldHideTranscriptFromUi(text)) {
                  applyCommittedTranscriptUpdate(source, text, committedAt);
                }
                return;
              }

              applyCommittedTranscriptUpdate(source, normalizedTranslated, committedAt);
            } catch (translationError) {
              if (translationSession !== transcriptMutationSessionRef.current) {
                return;
              }

              console.warn(
                `[SystemAudio][${source}] failed to normalize transcript to English:`,
                translationError
              );

              if (!shouldHideTranscriptFromUi(text)) {
                applyCommittedTranscriptUpdate(source, text, committedAt);
              }
            }
          })();

          trackPendingTranscriptTranslation(translationTask);
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
        onReconnectScheduled: (_reconnectSource, delayMs) => {
          reconnectScheduledCountRef.current += 1;
          reconnectDelaySamplesRef.current.push(Math.round(delayMs));
          if (reconnectDelaySamplesRef.current.length > 12) {
            reconnectDelaySamplesRef.current = reconnectDelaySamplesRef.current.slice(-12);
          }
        },
        onReconnectOpened: () => {
          reconnectOpenedCountRef.current += 1;
        },
      });
    },
    [
      applyCommittedTranscriptUpdate,
      appendLiveTranscript,
      clearInterimPromotionTimeout,
      clearLiveTranscript,
      commitLiveSegmentOnSpeakerSwitch,
      closeRealtimeConnection,
      selectedSttProvider,
      trackPendingTranscriptTranslation,
      translateTranscriptToEnglish,
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
      pendingScreenshotCaptureCountRef.current = 0;
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
      clearAllInterimPromotionTimeouts();
      pendingScreenshotCaptureCountRef.current = 0;
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
    clearAllInterimPromotionTimeouts,
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
      const initialInstruction = typedInstruction?.trim() ?? "";

      if (!capturing && !initialInstruction) {
        return false;
      }

      if (answerTriggerInFlightRef.current) {
        if (queuedAnswerTriggerRef.current) {
          triggerReplacedCountRef.current += 1;
          triggerDroppedCountRef.current += 1;
        } else {
          triggerQueuedCountRef.current += 1;
        }

        queuedAnswerTriggerRef.current = {
          typedInstruction: initialInstruction,
        };

        if (abortControllerRef.current) {
          triggerAbortRequestedCountRef.current += 1;
          abortControllerRef.current.abort();
        }

        return false;
      }

      answerTriggerInFlightRef.current = true;
      let queuedInstruction = initialInstruction;
      let sentAny = false;

      try {
        while (true) {
          if (capturing) {
            clearAllInterimPromotionTimeouts();
            commitBothStreams();
            commitLatestPartialTranscripts({
              latestPartialInterviewerRef,
              latestPartialUserRef,
              pendingCommitEchoRef,
              appendCommittedTranscript,
            });
          }

          const sent = await processPendingAnswer(queuedInstruction);
          sentAny = sentAny || sent;

          const nextQueuedInstruction = consumeQueuedAnswerTrigger();
          if (nextQueuedInstruction === null) {
            break;
          }

          queuedInstruction = nextQueuedInstruction;

          if (!capturing && !queuedInstruction) {
            break;
          }
        }

        return sentAny;
      } finally {
        answerTriggerInFlightRef.current = false;
        queuedAnswerTriggerRef.current = null;
      }

    },
    [
      appendCommittedTranscript,
      capturing,
      clearAllInterimPromotionTimeouts,
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
    registerScreenshotCallback(async () => {
      await handleCaptureScreenshot();
    });

    return () => {
      unregisterScreenshotCallback();
    };
  }, [handleCaptureScreenshot, registerScreenshotCallback, unregisterScreenshotCallback]);

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
      clearAllInterimPromotionTimeouts();
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
    clearAllInterimPromotionTimeouts,
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
    clearAllInterimPromotionTimeouts();
    pendingScreenshotCaptureCountRef.current = 0;
    setManualScreenshots((previous) => {
      return clearManualScreenshotsState(previous, manualScreenshotsRef);
    });
  }, [clearAllInterimPromotionTimeouts, resetInterviewState]);

  const clearPanelMemory = useCallback(
    (panel: "response" | "transcripts") => {
      if (panel === "response") {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }

        if (aiResponseFlushFrameRef.current !== null) {
          window.cancelAnimationFrame(aiResponseFlushFrameRef.current);
          aiResponseFlushFrameRef.current = null;
        }

        aiResponseBufferRef.current = "";
        queuedAnswerTriggerRef.current = null;
        setConversation(initialConversation());
        setLastAIResponse("");
        setError("");
        setIsProcessing(false);
        setIsAIProcessing(false);
        return;
      }

      queuedAnswerTriggerRef.current = null;
      setConversation(initialConversation());
      resetInterviewState();
      suppressCommittedTranscriptEcho();
      setError("");
    },
    [resetInterviewState, suppressCommittedTranscriptEcho]
  );

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
    processedManualScreenshotsCount,
    pendingManualScreenshotsCount,
    removeManualScreenshot,
    latencySnapshot,
    isCapturingScreenshot,
    handleCaptureScreenshot,
    onAnswerTrigger,
    scrollAreaRef,
    maxManualScreenshots,
    updateMaxManualScreenshots,
    clearPanelMemory,
  };
}
