import { normalizeTranscription } from "@/lib/utils";
import {
  type TranscriptSegment,
  type TranscriptSource,
  type TranscriptStability,
} from "@/types";

const MAX_TRANSCRIPT_SEGMENTS = 300;
const MAX_TRANSCRIPT_PROMPT_SEGMENTS = 120;
const NON_FINAL_REFINEMENT_MAX_AGE_MS = 12000;

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

export function pcm16BufferToBase64(buffer: ArrayBuffer): string {
  if (buffer.byteLength === 0) {
    return "";
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
  isLive: boolean = false,
  stability: TranscriptStability = isLive ? "interim" : "final"
): TranscriptSegment {
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    source,
    text,
    timestamp: Date.now(),
    isLive,
    stability,
  };
}

function trimSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= MAX_TRANSCRIPT_SEGMENTS) {
    return segments;
  }
  return segments.slice(segments.length - MAX_TRANSCRIPT_SEGMENTS);
}

function getStabilityRank(stability: TranscriptStability): number {
  if (stability === "interim") {
    return 0;
  }

  if (stability === "optimistic") {
    return 1;
  }

  return 2;
}

function isTranscriptRefinement(previous: string, next: string): boolean {
  if (!previous || !next) {
    return false;
  }

  if (next.startsWith(previous) || previous.startsWith(next)) {
    return true;
  }

  const previousTokens = previous.split(" ").filter(Boolean);
  const nextTokens = next.split(" ").filter(Boolean);
  if (previousTokens.length === 0 || nextTokens.length === 0) {
    return false;
  }

  const overlap = Math.min(previousTokens.length, nextTokens.length);
  let sharedPrefix = 0;
  for (let i = 0; i < overlap; i++) {
    if (previousTokens[i] !== nextTokens[i]) {
      break;
    }
    sharedPrefix += 1;
  }

  const minTokens = Math.min(previousTokens.length, nextTokens.length);
  return sharedPrefix >= Math.max(2, Math.floor(minTokens * 0.7));
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
        stability: "interim" as const,
      }
    : createSegment(source, normalizedText, true, "interim");

  const next = [...withoutLive, nextLive];

  return trimSegments(next);
}

export function commitSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  text: string,
  stability: TranscriptStability = "final"
): TranscriptSegment[] {
  const normalizedText = normalizeTranscription(text).trim();
  const now = Date.now();

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
      if (segment.stability === stability) {
        return trimSegments(next);
      }

      if (getStabilityRank(stability) <= getStabilityRank(segment.stability)) {
        return trimSegments(next);
      }

      next[i] = {
        ...segment,
        stability,
        timestamp: now,
      };
      return trimSegments(next);
    }

    // Keep a single bubble while the same speaker's non-final transcript
    // is still being refined by STT, even if the other speaker interleaves.
    if (
      segment.stability !== "final" &&
      now - segment.timestamp <= NON_FINAL_REFINEMENT_MAX_AGE_MS
    ) {
      next[i] = {
        ...segment,
        text: normalizedText,
        stability:
          getStabilityRank(stability) > getStabilityRank(segment.stability)
            ? stability
            : segment.stability,
        timestamp: now,
      };
      return trimSegments(next);
    }

    break;
  }

  const committed = createSegment(source, normalizedText, false, stability);
  next = [...next, committed];
  return trimSegments(next);
}

export function replaceLatestCommittedSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  previousText: string,
  nextText: string,
  stability: TranscriptStability = "final"
): TranscriptSegment[] | null {
  const normalizedPrevious = normalizeTranscription(previousText).trim();
  const normalizedNext = normalizeTranscription(nextText).trim();
  const now = Date.now();
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
        stability,
        timestamp: now,
      };
      return trimSegments(next);
    }
  }

  return null;
}

export function replaceLatestPendingCommittedSegment(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  nextText: string,
  stability: TranscriptStability = "final"
): TranscriptSegment[] | null {
  const normalizedNext = normalizeTranscription(nextText).trim();
  const now = Date.now();
  if (!normalizedNext) {
    return null;
  }

  const next = [...segments];
  for (let i = next.length - 1; i >= 0; i--) {
    const segment = next[i];
    if (segment.source !== source || segment.isLive || segment.stability === "final") {
      continue;
    }

    next[i] = {
      ...segment,
      text: normalizedNext,
      stability,
      timestamp: now,
    };
    return trimSegments(next);
  }

  return null;
}

export function replaceLatestCommittedSegmentIfRecent(
  segments: TranscriptSegment[],
  source: TranscriptSource,
  nextText: string,
  maxAgeMs: number = 8000,
  stability: TranscriptStability = "final"
): TranscriptSegment[] | null {
  const normalizedNext = normalizeTranscription(nextText).trim();
  if (!normalizedNext) {
    return null;
  }

  const now = Date.now();
  const maxAge = Math.max(0, Math.round(maxAgeMs));
  const next = [...segments];

  for (let i = next.length - 1; i >= 0; i--) {
    const segment = next[i];
    if (segment.source !== source || segment.isLive) {
      continue;
    }

    if (now - segment.timestamp > maxAge) {
      return null;
    }

    const normalizedCurrent = normalizeTranscription(segment.text).trim();
    if (!normalizedCurrent) {
      return null;
    }

    const appearsToBeRefinement = isTranscriptRefinement(
      normalizedCurrent,
      normalizedNext
    );

    if (!appearsToBeRefinement) {
      return null;
    }

    next[i] = {
      ...segment,
      text: normalizedNext,
      stability,
      timestamp: now,
    };

    return trimSegments(next);
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
