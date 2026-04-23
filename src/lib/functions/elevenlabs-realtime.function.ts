import { AudioFormat } from "@elevenlabs/client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const ELEVENLABS_REALTIME_STT_PROVIDER_ID =
  "elevenlabs-realtime-stt";
export const ELEVENLABS_REALTIME_DEFAULT_MODEL = "scribe_v2_realtime";
export const ELEVENLABS_REALTIME_DEFAULT_BASE_URI = "wss://api.elevenlabs.io";
export const ELEVENLABS_REALTIME_DEFAULT_LANGUAGE_CODE: string | null = null;
export const ELEVENLABS_REALTIME_DEFAULT_INCLUDE_TIMESTAMPS = true;
export type ElevenLabsRealtimeCommitStrategy = "manual" | "vad";
export const ELEVENLABS_REALTIME_DEFAULT_COMMIT_STRATEGY: ElevenLabsRealtimeCommitStrategy =
  "manual";
export const ELEVENLABS_REALTIME_DEFAULT_VAD_SILENCE_THRESHOLD_SECS = 1.5;
export const ELEVENLABS_REALTIME_DEFAULT_VAD_THRESHOLD = 0.4;
export const ELEVENLABS_REALTIME_DEFAULT_MIN_SPEECH_DURATION_MS = 100;
export const ELEVENLABS_REALTIME_DEFAULT_MIN_SILENCE_DURATION_MS = 100;
export const ELEVENLABS_REALTIME_DEFAULT_PREVIOUS_TEXT =
  "The interviewer will speak only in English or Hindi and may switch languages mid-sentence. Always output the transcript in English. Translate any Hindi speech into natural English and never return non-English scripts.";
export const ELEVENLABS_REALTIME_FALLBACK_BASE_URIS = [
  ELEVENLABS_REALTIME_DEFAULT_BASE_URI,
  "wss://api.us.elevenlabs.io",
  "wss://api.eu.residency.elevenlabs.io",
  "wss://api.in.residency.elevenlabs.io",
] as const;

export interface ElevenLabsRealtimeSelection {
  provider: string;
  variables: Record<string, string>;
}

export interface ElevenLabsRealtimeConfig {
  apiKey: string;
  model: string;
  baseUri: string | null;
  tokenBaseUrl: string | null;
  languageCode: string | null;
  commitStrategy: ElevenLabsRealtimeCommitStrategy;
  includeTimestamps: boolean;
  vadSilenceThresholdSecs: number | null;
  vadThreshold: number | null;
  minSpeechDurationMs: number | null;
  minSilenceDurationMs: number | null;
  previousText: string | null;
}

interface ElevenLabsRealtimeTokenResponse {
  token?: string;
  detail?: {
    message?: string;
  };
}

export function isElevenLabsRealtimeProvider(providerId: string): boolean {
  return providerId === ELEVENLABS_REALTIME_STT_PROVIDER_ID;
}

function normalizeUriValue(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function readVariable(
  variables: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = variables[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

export function getElevenLabsRealtimeConfig(
  selectedProvider: ElevenLabsRealtimeSelection
): ElevenLabsRealtimeConfig {
  const variables = selectedProvider.variables;
  const apiKey = readVariable(variables, "api_key")?.trim();
  const model = readVariable(variables, "model")?.trim() || ELEVENLABS_REALTIME_DEFAULT_MODEL;
  const baseUri = null;
  const tokenBaseUrl = null;
  const languageCode = ELEVENLABS_REALTIME_DEFAULT_LANGUAGE_CODE;
  const commitStrategy = ELEVENLABS_REALTIME_DEFAULT_COMMIT_STRATEGY;
  const includeTimestamps = ELEVENLABS_REALTIME_DEFAULT_INCLUDE_TIMESTAMPS;
  const vadSilenceThresholdSecs = null;
  const vadThreshold = null;
  const minSpeechDurationMs = null;
  const minSilenceDurationMs = null;
  const previousText = ELEVENLABS_REALTIME_DEFAULT_PREVIOUS_TEXT;

  if (!apiKey) {
    throw new Error("ElevenLabs realtime STT requires an API key.");
  }

  return {
    apiKey,
    model,
    baseUri,
    tokenBaseUrl,
    languageCode,
    commitStrategy,
    includeTimestamps,
    vadSilenceThresholdSecs,
    vadThreshold,
    minSpeechDurationMs,
    minSilenceDurationMs,
    previousText,
  };
}

interface FetchRealtimeTokenOptions {
  tokenBaseUrl?: string | null;
  model?: string;
}

async function parseTokenErrorMessage(response: any): Promise<string> {
  try {
    const errorBody = (await response.json()) as ElevenLabsRealtimeTokenResponse;
    if (errorBody?.detail?.message) {
      return errorBody.detail.message;
    }
  } catch {
    // no-op
  }

  if (typeof response?.text === "function") {
    try {
      const text = await response.text();
      if (typeof text === "string" && text.trim()) {
        return text.trim();
      }
    } catch {
      // no-op
    }
  }

  return `Failed to get ElevenLabs realtime token (${response.status})`;
}

export async function fetchElevenLabsRealtimeToken(
  apiKey: string,
  options?: FetchRealtimeTokenOptions
): Promise<string> {
  const tokenBaseUrl =
    normalizeUriValue(options?.tokenBaseUrl) || "https://api.elevenlabs.io";

  const headers: Record<string, string> = {
    "xi-api-key": apiKey,
    Accept: "application/json",
    "Cache-Control": "no-cache",
  };
  const model = options?.model?.trim();
  if (model) {
    headers["x-model-id"] = model;
  }

  const response = await tauriFetch(
    `${tokenBaseUrl}/v1/single-use-token/realtime_scribe`,
    {
      method: "POST",
      headers,
    }
  );

  if (!response.ok) {
    throw new Error(await parseTokenErrorMessage(response));
  }

  const data = (await response.json()) as ElevenLabsRealtimeTokenResponse;
  if (!data.token) {
    throw new Error("ElevenLabs realtime token response was missing a token.");
  }

  return data.token;
}

export function getElevenLabsAudioFormat(sampleRate: number): AudioFormat {
  switch (sampleRate) {
    case 8000:
      return AudioFormat.PCM_8000;
    case 16000:
      return AudioFormat.PCM_16000;
    case 22050:
      return AudioFormat.PCM_22050;
    case 24000:
      return AudioFormat.PCM_24000;
    case 44100:
      return AudioFormat.PCM_44100;
    case 48000:
      return AudioFormat.PCM_48000;
    default:
      throw new Error(
        `ElevenLabs realtime does not support a ${sampleRate}Hz system audio stream.`
      );
  }
}
