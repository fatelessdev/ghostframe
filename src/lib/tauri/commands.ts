import { invoke } from "@tauri-apps/api/core";
import type { SystemAudioVadConfig } from "@/types";

export type StartSystemAudioCaptureArgs = {
  vadConfig: SystemAudioVadConfig;
  deviceId: string | null;
};

export const tauriCommands = {
  captureToBase64: async (): Promise<string> => {
    return invoke<string>("capture_to_base64");
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
};
