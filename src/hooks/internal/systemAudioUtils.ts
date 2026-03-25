import { normalizeTranscription } from "@/lib/utils";
import { type TranscriptSegment, type TranscriptSource } from "@/types";

const MAX_TRANSCRIPT_SEGMENTS = 300;
const MAX_TRANSCRIPT_PROMPT_SEGMENTS = 120;

export const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  return String(value);
};

export const isCaptureAlreadyRunningError = (value: unknown): boolean => {
  return toErrorMessage(value).toLowerCase().includes("capture already running");
};

export const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
};

export const estimatePcm16DurationMs = (
  audioBase64: string,
  sampleRate: number
): number => {
  if (!audioBase64 || sampleRate <= 0) {
    return 0;
  }

  const padding = audioBase64.endsWith("==") ? 2 : audioBase64.endsWith("=") ? 1 : 0;
  const byteLength = Math.max(0, Math.floor((audioBase64.length * 3) / 4) - padding);
  const sampleCount = byteLength / 2;
  return (sampleCount / sampleRate) * 1000;
};

export const toUniqueBaseUris = (
  preferred: (string | null | undefined)[]
): string[] => {
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

export function float32ToPcm16Base64(frame: Float32Array): string {
  const buffer = new ArrayBuffer(frame.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < frame.length; i++) {
    const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
    const pcm =
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(i * 2, pcm, true);
  }

  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }

  return btoa(chunks.join(""));
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

export function replaceLiveSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  text: string
): TranscriptSegment[] {
  const normalizedText = normalizeTranscription(text).trim();
  if (!normalizedText) {
    return segments;
  }

  const withoutLive = segments.filter((item) => {
    return !item.isLive || item.source !== source;
  });

  const existingLive = segments.find((item) => item.source === source && item.isLive);
  const nextLive = existingLive
    ? {
        ...existingLive,
        text: normalizedText,
        timestamp: Date.now(),
      }
    : createSegment(source, normalizedText, true);

  const next = [...withoutLive, nextLive];

  return trimSegments(next);
}

export function commitSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  text: string
): TranscriptSegment[] {
  const normalizedText = normalizeTranscription(text).trim();

  let next = segments.filter((item) => {
    return !item.isLive || item.source !== source;
  });

  if (!normalizedText) {
    return trimSegments(next);
  }

  for (let i = next.length - 1; i >= 0; i--) {
    const segment = next[i];
    if (segment.source !== source || segment.isLive) {
      continue;
    }

    if (segment.text === normalizedText) {
      return trimSegments(next);
    }

    break;
  }

  const committed = createSegment(source, normalizedText, false);
  next = [...next, committed];
  return trimSegments(next);
}

export function replaceLatestCommittedSegment(
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

export function mergeTranscriptForPrompt(
  segments: TranscriptSegment[],
  cutoffAt?: number
): string {
  const committedSegments = segments
    .filter((item) => !item.isLive)
    .filter((item) => (typeof cutoffAt === "number" ? item.timestamp <= cutoffAt : true));

  const compactedSegments =
    committedSegments.length > MAX_TRANSCRIPT_PROMPT_SEGMENTS
      ? committedSegments.slice(-MAX_TRANSCRIPT_PROMPT_SEGMENTS)
      : committedSegments;

  return compactedSegments
    .map((item) => {
      const label = item.source === "interviewer" ? "Interviewer" : "User";
      return `${label}: "${item.text}"`;
    })
    .join("\n");
}

export function retainUnsentSegments(
  segments: TranscriptSegment[],
  cutoffAt: number
): TranscriptSegment[] {
  return trimSegments(
    segments.filter((item) => item.isLive || item.timestamp > cutoffAt)
  );
}
