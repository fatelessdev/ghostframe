import { invoke } from "@tauri-apps/api/core";
import type { AIImagePayload, SystemAudioVadConfig } from "@/types";

type TauriCapturedImagePayload = {
  base64: string;
  mime_type: string;
  width: number;
  height: number;
  bytes: number;
};

export type StartSystemAudioCaptureArgs = {
  vadConfig: SystemAudioVadConfig;
  deviceId: string | null;
};

export const tauriCommands = {
  captureToBase64: async (): Promise<string> => {
    return invoke<string>("capture_to_base64");
  },
  captureToImagePayload: async (): Promise<AIImagePayload> => {
    const payload = await invoke<TauriCapturedImagePayload>(
      "capture_to_image_payload"
    );

    return {
      base64: payload.base64,
      mimeType: payload.mime_type,
      width: payload.width,
      height: payload.height,
      bytes: payload.bytes,
    };
  },
  startScreenCapture: async (): Promise<void> => {
    await invoke("start_screen_capture");
  },
  updateVadConfig: async (config: SystemAudioVadConfig): Promise<void> => {
    await invoke("update_vad_config", { config });
  },
  stopSystemAudioCapture: async (): Promise<string> => {
    return invoke<string>("stop_system_audio_capture");
  },
  requestSystemAudioAccess: async (): Promise<void> => {
    await invoke("request_system_audio_access");
  },
  checkSystemAudioAccess: async (): Promise<boolean> => {
    return invoke<boolean>("check_system_audio_access");
  },
  getCaptureStatus: async (): Promise<boolean> => {
    return invoke<boolean>("get_capture_status");
  },
  getAudioSampleRate: async (deviceId: string | null): Promise<number> => {
    return invoke<number>("get_audio_sample_rate", { deviceId });
  },
  startSystemAudioCapture: async (
    args: StartSystemAudioCaptureArgs
  ): Promise<string> => {
    return invoke<string>("start_system_audio_capture", args);
  },
  exitApp: async (): Promise<void> => {
    await invoke("exit_app");
  },
  appendSystemAudioLogLine: async (line: string): Promise<void> => {
    await invoke("append_system_audio_log_line", { line });
  },
};
