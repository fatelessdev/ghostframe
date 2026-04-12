import { RealtimeEvents, RealtimeConnection } from "@elevenlabs/client";
import { type RealtimeAudioChunkEvent } from "@/lib";
import { type TranscriptSource } from "@/types";
import { estimatePcm16DurationMs } from "@/hooks/internal/systemAudioUtils";

export type RealtimeCommitStrategy = "manual" | "vad";

export type RealtimeHandle = {
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
  commitStrategy: RealtimeCommitStrategy;
  queue: RealtimeAudioChunkEvent[];
  queueHead: number;
  droppedQueueChunks: number;
};

export const REALTIME_ERROR_EVENTS: ReadonlyArray<RealtimeEvents> = [
  RealtimeEvents.AUTH_ERROR,
  RealtimeEvents.UNACCEPTED_TERMS,
  RealtimeEvents.QUOTA_EXCEEDED,
  RealtimeEvents.RATE_LIMITED,
  RealtimeEvents.TRANSCRIBER_ERROR,
  RealtimeEvents.RESOURCE_EXHAUSTED,
  RealtimeEvents.INSUFFICIENT_AUDIO_ACTIVITY,
  RealtimeEvents.INPUT_ERROR,
  RealtimeEvents.QUEUE_OVERFLOW,
  RealtimeEvents.SESSION_TIME_LIMIT_EXCEEDED,
  RealtimeEvents.CHUNK_SIZE_EXCEEDED,
  RealtimeEvents.COMMIT_THROTTLED,
];

type CloseRealtimeHandleOptions = {
  preserveReconnect?: boolean;
  reason?: string;
  onClosing?: (message: string) => void;
  onCloseError?: (error: unknown) => void;
};

export const createRealtimeHandle = (label: TranscriptSource): RealtimeHandle => {
  return {
    label,
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
    commitStrategy: "manual",
    queue: [],
    queueHead: 0,
    droppedQueueChunks: 0,
  };
};

export const getRealtimeQueueLength = (handle: RealtimeHandle): number => {
  return Math.max(0, handle.queue.length - handle.queueHead);
};

const compactRealtimeQueue = (handle: RealtimeHandle): void => {
  if (handle.queueHead <= 0) {
    return;
  }

  if (handle.queueHead >= handle.queue.length) {
    handle.queue = [];
    handle.queueHead = 0;
    return;
  }

  if (handle.queueHead < 256 && handle.queueHead * 2 < handle.queue.length) {
    return;
  }

  handle.queue = handle.queue.slice(handle.queueHead);
  handle.queueHead = 0;
};

export const flushRealtimeQueue = (handle: RealtimeHandle): void => {
  if (!handle.connection || !handle.ready) {
    return;
  }

  while (handle.queueHead < handle.queue.length) {
    const chunk = handle.queue[handle.queueHead];
    handle.queueHead += 1;
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

  compactRealtimeQueue(handle);
};

export const sendRealtimeChunk = (
  handle: RealtimeHandle,
  chunk: RealtimeAudioChunkEvent,
  queueLimit: number
): void => {
  if (!handle.connection || !handle.ready) {
    handle.queue.push(chunk);

    if (getRealtimeQueueLength(handle) > queueLimit) {
      handle.queueHead += 1;
      handle.droppedQueueChunks += 1;
      compactRealtimeQueue(handle);
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
};

export const closeRealtimeHandle = (
  handle: RealtimeHandle,
  options: CloseRealtimeHandleOptions = {}
): void => {
  const preserveReconnect = options.preserveReconnect ?? false;
  const reason = options.reason || "unknown";

  if (handle.reconnectTimeoutId !== null) {
    window.clearTimeout(handle.reconnectTimeoutId);
    handle.reconnectTimeoutId = null;
  }

  if (handle.keepAliveIntervalId !== null) {
    window.clearInterval(handle.keepAliveIntervalId);
    handle.keepAliveIntervalId = null;
  }

  handle.ready = false;
  if (!preserveReconnect) {
    handle.queue = [];
    handle.queueHead = 0;
    handle.droppedQueueChunks = 0;
    handle.shouldReconnect = false;
  } else {
    compactRealtimeQueue(handle);
  }
  handle.reconnecting = false;
  handle.connectAttempts = 0;
  handle.activeBaseUri = null;
  handle.activeSampleRate = null;
  handle.errorLabel = "";
  handle.lastSentAtMs = 0;
  handle.uncommittedAudioMs = 0;
  handle.commitStrategy = "manual";
  handle.connectionId = null;

  if (handle.connection) {
    options.onClosing?.(
      `[SystemAudio][${handle.label}] closing realtime connection (${reason})`
    );
    try {
      handle.connection.close();
    } catch (closeError) {
      options.onCloseError?.(closeError);
    }
  }

  handle.connection = null;
};

export const commitRealtimeHandle = (
  handle: RealtimeHandle,
  minCommitAudioMs: number,
  onError?: (error: unknown) => void
): boolean => {
  if (!handle.connection || !handle.ready) {
    return false;
  }

  if (handle.commitStrategy === "vad") {
    return false;
  }

  if (handle.uncommittedAudioMs < minCommitAudioMs) {
    return false;
  }

  try {
    handle.connection.commit();
    handle.uncommittedAudioMs = 0;
    return true;
  } catch (error) {
    onError?.(error);
    return false;
  }
};
