import { AudioFormat } from "@elevenlabs/client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const ELEVENLABS_REALTIME_STT_PROVIDER_ID =
  "elevenlabs-realtime-stt";
export const ELEVENLABS_REALTIME_DEFAULT_MODEL = "scribe_v2_realtime";

export interface ElevenLabsRealtimeSelection {
  provider: string;
  variables: Record<string, string>;
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

export function getElevenLabsRealtimeConfig(
  selectedProvider: ElevenLabsRealtimeSelection
): { apiKey: string; model: string } {
  const apiKey = selectedProvider.variables.api_key?.trim();
  const model =
    selectedProvider.variables.model?.trim() ||
    ELEVENLABS_REALTIME_DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error("ElevenLabs realtime STT requires an API key.");
  }

  return { apiKey, model };
}

export async function fetchElevenLabsRealtimeToken(
  apiKey: string
): Promise<string> {
  const response = await tauriFetch(
    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
    }
  );

  if (!response.ok) {
    const errorBody = (await response.json()) as ElevenLabsRealtimeTokenResponse;
    throw new Error(
      errorBody?.detail?.message ||
        `Failed to get ElevenLabs realtime token (${response.status})`
    );
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
