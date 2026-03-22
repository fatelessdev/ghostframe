import { listen, type UnlistenFn, type Event } from "@tauri-apps/api/event";

export type RealtimeAudioChunkEvent = {
  sample_rate: number;
  audio_base64: string;
};

export const tauriEvents = {
  onCapturedSelection: async (
    handler: (base64: string) => void | Promise<void>
  ): Promise<UnlistenFn> => {
    return listen<string>("captured-selection", async (event: Event<string>) => {
      await handler(event.payload);
    });
  },
  onCaptureClosed: async (handler: () => void): Promise<UnlistenFn> => {
    return listen("capture-closed", () => {
      handler();
    });
  },
  onSpeechRealtimeChunk: async (
    handler: (payload: RealtimeAudioChunkEvent) => void | Promise<void>
  ): Promise<UnlistenFn> => {
    return listen<RealtimeAudioChunkEvent>(
      "speech-realtime-chunk",
      async (event: Event<RealtimeAudioChunkEvent>) => {
        await handler(event.payload);
      }
    );
  },
};
