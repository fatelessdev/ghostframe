import { AudioFormat } from "@elevenlabs/client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const ELEVENLABS_REALTIME_STT_PROVIDER_ID =
  "elevenlabs-realtime-stt";
export const ELEVENLABS_REALTIME_DEFAULT_MODEL = "scribe_v2_realtime";
export const ELEVENLABS_REALTIME_DEFAULT_BASE_URI = "wss://api.elevenlabs.io";
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

function normalizeWebsocketBaseUri(value?: string | null): string | null {
  let normalized = normalizeUriValue(value);
  if (!normalized) {
    return null;
  }

  normalized = normalized
    .replace(/\/v1\/speech-to-text\/realtime$/i, "")
    .replace(/\/v1\/speech-to-text$/i, "");

  if (!/^wss?:\/\//i.test(normalized)) {
    normalized = "wss://" + normalized.replace(/^https?:\/\//i, "");
  }

  return normalized;
}

function normalizeTokenBaseUrl(value?: string | null): string | null {
  let normalized = normalizeUriValue(value);
  if (!normalized) {
    return null;
  }

  normalized = normalized.replace(/\/v1\/single-use-token\/realtime_scribe$/i, "");

  if (!/^https?:\/\//i.test(normalized)) {
    normalized = "https://" + normalized.replace(/^wss?:\/\//i, "");
  }

  return normalized;
}

export function getElevenLabsRealtimeConfig(
  selectedProvider: ElevenLabsRealtimeSelection
): ElevenLabsRealtimeConfig {
  const apiKey = selectedProvider.variables.api_key?.trim();
  const model =
    selectedProvider.variables.model?.trim() ||
    ELEVENLABS_REALTIME_DEFAULT_MODEL;
  const baseUri = normalizeUriValue(
    normalizeWebsocketBaseUri(
      selectedProvider.variables.base_uri ||
        selectedProvider.variables.websocket_base_uri
    )
  );
  const tokenBaseUrl = normalizeUriValue(
    normalizeTokenBaseUrl(
      selectedProvider.variables.token_base_url ||
        selectedProvider.variables.api_base_url
    )
  );

  if (!apiKey) {
    throw new Error("ElevenLabs realtime STT requires an API key.");
  }

  return { apiKey, model, baseUri, tokenBaseUrl };
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
