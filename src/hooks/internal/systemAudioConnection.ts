import {
  RealtimeConnection,
  RealtimeEvents,
} from "@elevenlabs/client";
import {
  ELEVENLABS_REALTIME_DEFAULT_BASE_URI,
  ELEVENLABS_REALTIME_FALLBACK_BASE_URIS,
  fetchElevenLabsRealtimeToken,
  getElevenLabsAudioFormat,
  type ElevenLabsRealtimeCommitStrategy,
} from "@/lib";
import { type TranscriptSource } from "@/types";
import {
  float32ToPcm16Base64,
  toUniqueBaseUris,
} from "@/hooks/internal/systemAudioUtils";
import {
  flushRealtimeQueue,
  REALTIME_ERROR_EVENTS,
  type RealtimeHandle,
} from "@/hooks/internal/systemAudioRealtime";

type RealtimeConfig = {
  apiKey: string;
  model: string;
  baseUri?: string | null;
  tokenBaseUrl?: string | null;
  languageCode: string | null;
  commitStrategy: ElevenLabsRealtimeCommitStrategy;
  includeTimestamps: boolean;
  includeLanguageDetection: boolean;
  vadSilenceThresholdSecs: number | null;
  vadThreshold: number | null;
  minSpeechDurationMs: number | null;
  minSilenceDurationMs: number | null;
  previousText: string | null;
};

export type RealtimeCommittedTranscript = {
  text: string;
  languageCode: string | null;
};

type ConnectSystemAudioRealtimeOptions = {
  handle: RealtimeHandle;
  source: TranscriptSource;
  sampleRate: number;
  signal: AbortSignal;
  realtimeConfig: RealtimeConfig;
  maxConnectAttempts: number;
  retryDelayMs: number;
  keepAliveIntervalMs: number;
  keepAliveSilenceMs: number;
  bootstrapSilenceMs: number;
  getNextConnectionId: () => number;
  closeRealtime: (
    handle: RealtimeHandle,
    options?: { preserveReconnect?: boolean; reason?: string }
  ) => void;
  onReady: () => void;
  onPartialTranscript: (text: string) => void;
  onCommittedTranscript: (payload: RealtimeCommittedTranscript) => void;
  onRealtimeError: (message: string, event?: unknown) => void;
  onInfo: (message: string) => void;
  onWarn: (message: string) => void;
  onReconnectError: (error: unknown) => void;
  onReconnectScheduled?: (source: TranscriptSource, delayMs: number) => void;
  onReconnectOpened?: (source: TranscriptSource, attempt: number) => void;
};

const isExpectedSocketClose = (
  eventMessage: string,
  messageType?: string
): boolean => {
  return (
    eventMessage.includes("1000 - User ended session") ||
    eventMessage.includes("insufficient_audio_activity") ||
    eventMessage.includes("commit_throttled") ||
    messageType === "commit_throttled" ||
    eventMessage.toLowerCase().includes("commit request ignored")
  );
};

const delay = async (ms: number): Promise<void> => {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
};

const silencePcm16Cache = new Map<string, string>();

const getRealtimeToken = async (
  apiKey: string,
  model: string,
  tokenBaseUrl: string
): Promise<string> => {
  return fetchElevenLabsRealtimeToken(apiKey, {
    model,
    tokenBaseUrl,
  });
};

const getRetryDelayMs = (baseDelayMs: number, attempt: number): number => {
  const normalizedBaseDelay = Math.max(100, Math.round(baseDelayMs));
  const normalizedAttempt = Math.max(1, Math.round(attempt));
  const step = Math.min(normalizedAttempt, 4);
  const exponentialDelay = normalizedBaseDelay * step;
  const jitterAmplitude = Math.round(exponentialDelay * 0.35);
  const jitter = Math.round((Math.random() * 2 - 1) * jitterAmplitude);
  return Math.max(120, exponentialDelay + jitter);
};

const getSilencePcm16Base64 = (sampleRate: number, silenceMs: number): string => {
  const normalizedSampleRate = Math.max(1, Math.round(sampleRate));
  const normalizedSilenceMs = Math.max(1, Math.round(silenceMs));
  const cacheKey = `${normalizedSampleRate}:${normalizedSilenceMs}`;
  const cached = silencePcm16Cache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const sampleCount = Math.max(
    1,
    Math.round((normalizedSampleRate * normalizedSilenceMs) / 1000)
  );
  const silence = new Float32Array(sampleCount);
  const encoded = float32ToPcm16Base64(silence);
  silencePcm16Cache.set(cacheKey, encoded);
  return encoded;
};

const buildRealtimeWebSocketUri = ({
  baseUri,
  token,
  modelId,
  commitStrategy,
  audioFormat,
  languageCode,
  includeTimestamps,
  includeLanguageDetection,
  vadSilenceThresholdSecs,
  vadThreshold,
  minSpeechDurationMs,
  minSilenceDurationMs,
}: {
  baseUri: string;
  token: string;
  modelId: string;
  commitStrategy: ElevenLabsRealtimeCommitStrategy;
  audioFormat: ReturnType<typeof getElevenLabsAudioFormat>;
  languageCode: string | null;
  includeTimestamps: boolean;
  includeLanguageDetection: boolean;
  vadSilenceThresholdSecs: number | null;
  vadThreshold: number | null;
  minSpeechDurationMs: number | null;
  minSilenceDurationMs: number | null;
}): string => {
  const normalizedBaseUri = baseUri.endsWith("/") ? baseUri : `${baseUri}/`;
  const websocketUrl = new URL("v1/speech-to-text/realtime", normalizedBaseUri);

  websocketUrl.searchParams.set("model_id", modelId);
  websocketUrl.searchParams.set("token", token);
  websocketUrl.searchParams.set("audio_format", audioFormat);
  websocketUrl.searchParams.set("commit_strategy", commitStrategy);
  websocketUrl.searchParams.set(
    "include_timestamps",
    includeTimestamps ? "true" : "false"
  );
  websocketUrl.searchParams.set(
    "include_language_detection",
    includeLanguageDetection ? "true" : "false"
  );

  if (languageCode) {
    websocketUrl.searchParams.set("language_code", languageCode);
  }

  if (typeof vadSilenceThresholdSecs === "number") {
    websocketUrl.searchParams.set(
      "vad_silence_threshold_secs",
      String(vadSilenceThresholdSecs)
    );
  }

  if (typeof vadThreshold === "number") {
    websocketUrl.searchParams.set("vad_threshold", String(vadThreshold));
  }

  if (typeof minSpeechDurationMs === "number") {
    websocketUrl.searchParams.set(
      "min_speech_duration_ms",
      String(minSpeechDurationMs)
    );
  }

  if (typeof minSilenceDurationMs === "number") {
    websocketUrl.searchParams.set(
      "min_silence_duration_ms",
      String(minSilenceDurationMs)
    );
  }

  return websocketUrl.toString();
};

const createRealtimeConnection = ({
  baseUri,
  token,
  modelId,
  sampleRate,
  audioFormat,
  languageCode,
  commitStrategy,
  includeTimestamps,
  includeLanguageDetection,
  vadSilenceThresholdSecs,
  vadThreshold,
  minSpeechDurationMs,
  minSilenceDurationMs,
}: {
  baseUri: string;
  token: string;
  modelId: string;
  sampleRate: number;
  audioFormat: ReturnType<typeof getElevenLabsAudioFormat>;
  languageCode: string | null;
  commitStrategy: ElevenLabsRealtimeCommitStrategy;
  includeTimestamps: boolean;
  includeLanguageDetection: boolean;
  vadSilenceThresholdSecs: number | null;
  vadThreshold: number | null;
  minSpeechDurationMs: number | null;
  minSilenceDurationMs: number | null;
}): RealtimeConnection => {
  const websocketUri = buildRealtimeWebSocketUri({
    baseUri,
    token,
    modelId,
    commitStrategy,
    audioFormat,
    languageCode,
    includeTimestamps,
    includeLanguageDetection,
    vadSilenceThresholdSecs,
    vadThreshold,
    minSpeechDurationMs,
    minSilenceDurationMs,
  });

  const connection = new RealtimeConnection(sampleRate);
  connection.setWebSocket(new WebSocket(websocketUri));
  return connection;
};

export const connectSystemAudioRealtime = async (
  options: ConnectSystemAudioRealtimeOptions
): Promise<void> => {
  const {
    handle,
    source,
    sampleRate,
    signal,
    realtimeConfig,
    maxConnectAttempts,
    retryDelayMs,
    keepAliveIntervalMs,
    keepAliveSilenceMs,
    bootstrapSilenceMs,
    getNextConnectionId,
    closeRealtime,
    onReady,
    onPartialTranscript,
    onCommittedTranscript,
    onRealtimeError,
    onInfo,
    onWarn,
    onReconnectError,
    onReconnectScheduled,
    onReconnectOpened,
  } = options;

  const candidateBaseUris = toUniqueBaseUris([
    realtimeConfig.baseUri,
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
      realtimeConfig.tokenBaseUrl,
      derivedTokenBaseUrl,
      "https://api.elevenlabs.io",
    ]);

    for (let attempt = 1; attempt <= maxConnectAttempts; attempt++) {
      if (signal.aborted) {
        throw new Error("Realtime connection cancelled");
      }

      if (handle.connection) {
        closeRealtime(handle, {
          preserveReconnect: true,
          reason: `reconnect_attempt:${source}:${attempt}`,
        });
      }

      const activeTokenBaseUrl =
        tokenBaseCandidates[
          Math.min(attempt - 1, Math.max(tokenBaseCandidates.length - 1, 0))
        ] || "https://api.elevenlabs.io";
      const connectionId = getNextConnectionId();

      try {
        const token = await getRealtimeToken(
          realtimeConfig.apiKey,
          realtimeConfig.model,
          activeTokenBaseUrl
        );

        if (signal.aborted) {
          throw new Error("Realtime connection cancelled");
        }

        let openResolved = false;
        let sessionResolved = false;
        let settled = false;
        let lastCommittedText = "";
        let lastCommittedAt = 0;

        await new Promise<void>((resolve, reject) => {
          const connection = createRealtimeConnection({
            baseUri: candidateBaseUri,
            token,
            modelId: realtimeConfig.model,
            sampleRate,
            audioFormat,
            languageCode: realtimeConfig.languageCode,
            commitStrategy: realtimeConfig.commitStrategy,
            includeTimestamps: realtimeConfig.includeTimestamps,
            includeLanguageDetection: realtimeConfig.includeLanguageDetection,
            vadSilenceThresholdSecs: realtimeConfig.vadSilenceThresholdSecs,
            vadThreshold: realtimeConfig.vadThreshold,
            minSpeechDurationMs: realtimeConfig.minSpeechDurationMs,
            minSilenceDurationMs: realtimeConfig.minSilenceDurationMs,
          });

          if (signal.aborted) {
            connection.close();
            reject(new Error("Realtime connection cancelled"));
            return;
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
          handle.commitStrategy = realtimeConfig.commitStrategy;

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

          const isCurrentConnection = (): boolean => {
            return handle.connectionId === connectionId && !signal.aborted;
          };

          const captureStructuredRealtimeError = (event: unknown) => {
            const normalizedEvent = event as {
              error?: string;
              message_type?: string;
            };
            const eventMessage =
              (typeof normalizedEvent?.error === "string" &&
                normalizedEvent.error.trim()) ||
              (event instanceof Error ? event.message : "");

            if (eventMessage) {
              handle.errorLabel = eventMessage;
            }

            if (!openResolved || signal.aborted) {
              return;
            }

            if (isExpectedSocketClose(eventMessage, normalizedEvent?.message_type)) {
              onWarn(
                `[SystemAudio][${source}] transient realtime close: ${eventMessage}`
              );
              return;
            }

            onRealtimeError(eventMessage || "Realtime transcription failed.", event);
          };

          const emitCommittedTranscript = (payload: RealtimeCommittedTranscript) => {
            const normalized = payload.text.trim();
            if (!normalized) {
              return;
            }

            const now = Date.now();
            if (normalized === lastCommittedText && now - lastCommittedAt < 300) {
              return;
            }

            lastCommittedText = normalized;
            lastCommittedAt = now;
            onCommittedTranscript(payload);
          };

          connection.on(RealtimeEvents.OPEN, () => {
            openResolved = true;
            onInfo(`[SystemAudio][${source}] realtime open via ${candidateBaseUri}`);
          });

          connection.on(RealtimeEvents.SESSION_STARTED, () => {
            sessionResolved = true;
            handle.ready = true;
            handle.connectAttempts = 0;
            onReconnectOpened?.(source, attempt);
            const bootstrapSilenceSamples = Math.max(
              128,
              Math.round(sampleRate * (bootstrapSilenceMs / 1000))
            );
            const bootstrapSilenceDurationMs =
              (bootstrapSilenceSamples / sampleRate) * 1000;
            const bootstrapAudio = getSilencePcm16Base64(
              sampleRate,
              bootstrapSilenceDurationMs
            );
            connection.send({
              audioBase64: bootstrapAudio,
              sampleRate,
              ...(realtimeConfig.previousText
                ? {
                    previousText: realtimeConfig.previousText,
                  }
                : {}),
            });
            handle.lastSentAtMs = Date.now();

            onReady();
            flushRealtimeQueue(handle);
            onInfo(
              `[SystemAudio][${source}] session started @${sampleRate}Hz (commit=${realtimeConfig.commitStrategy}${realtimeConfig.languageCode ? `, language=${realtimeConfig.languageCode}` : ""})`
            );

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

              if (Date.now() - handle.lastSentAtMs < keepAliveIntervalMs) {
                return;
              }

              const silenceSamples = Math.max(
                256,
                Math.round(handle.activeSampleRate * (keepAliveSilenceMs / 1000))
              );
              const keepAliveSilenceDurationMs =
                (silenceSamples / handle.activeSampleRate) * 1000;
              const keepAliveAudio = getSilencePcm16Base64(
                handle.activeSampleRate,
                keepAliveSilenceDurationMs
              );
              handle.connection.send({
                audioBase64: keepAliveAudio,
                sampleRate: handle.activeSampleRate,
              });
              handle.lastSentAtMs = Date.now();
            }, keepAliveIntervalMs);

            settleResolve();
          });

          connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
            if (!isCurrentConnection()) {
              return;
            }

            onPartialTranscript(data.text);
          });

          connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
            if (!isCurrentConnection()) {
              return;
            }

            emitCommittedTranscript({
              text: data.text,
              languageCode: realtimeConfig.languageCode,
            });
          });

          connection.on(
            RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS,
            (data) => {
              if (!isCurrentConnection()) {
                return;
              }

              emitCommittedTranscript({
                text: data.text,
                languageCode:
                  typeof data.language_code === "string"
                    ? data.language_code
                    : realtimeConfig.languageCode,
              });
            }
          );

          REALTIME_ERROR_EVENTS.forEach((eventName) => {
            connection.on(eventName, captureStructuredRealtimeError);
          });

          connection.on(RealtimeEvents.ERROR, (event) => {
            captureStructuredRealtimeError(event);
            const normalizedEvent = event as { error?: string };

            if (openResolved) {
              return;
            }

            const reason =
              (typeof normalizedEvent?.error === "string" &&
                normalizedEvent.error.trim()) ||
              handle.errorLabel ||
              "Connection error before websocket opened";
            settleReject(
              `Failed to open ${source} realtime stream at ${candidateBaseUri}: ${reason}`
            );
          });

          connection.on(RealtimeEvents.CLOSE, (closeEvent) => {
            if (handle.connectionId !== connectionId) {
              onInfo(
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
              onWarn(
                `[SystemAudio][${source}] realtime closed (${closeCode}) ${closeReason}; reconnect=${shouldReconnect} (id=${connectionId}, shouldReconnect=${handle.shouldReconnect}, aborted=${signal.aborted})`
              );

              if (shouldReconnect && !handle.reconnecting) {
                handle.reconnecting = true;
                const reconnectDelayMs = getRetryDelayMs(retryDelayMs, attempt);
                onReconnectScheduled?.(source, reconnectDelayMs);
                handle.reconnectTimeoutId = window.setTimeout(() => {
                  handle.reconnectTimeoutId = null;
                  if (signal.aborted) {
                    handle.reconnecting = false;
                    return;
                  }
                  connectSystemAudioRealtime(options)
                    .catch((error) => {
                      onReconnectError(error);
                    })
                    .finally(() => {
                      handle.reconnecting = false;
                    });
                }, reconnectDelayMs);
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
          onWarn(
            `[SystemAudio][${source}] open attempt ${attempt}/${maxConnectAttempts} failed with transient close: ${message}`
          );
        }

        lastOpenError = message;
        handle.errorLabel = message;
        handle.ready = false;

        if (attempt < maxConnectAttempts) {
          await delay(getRetryDelayMs(retryDelayMs, attempt));
        }
      }
    }
  }

  const fallbackMessage =
    lastOpenError ||
    `Failed to connect ${source} realtime stream after trying all endpoints.`;
  throw new Error(fallbackMessage);
};

export type { RealtimeConfig, ConnectSystemAudioRealtimeOptions };
