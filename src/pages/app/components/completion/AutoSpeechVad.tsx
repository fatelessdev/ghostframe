import {
  fetchSTT,
  fetchElevenLabsRealtimeToken,
  getElevenLabsAudioFormat,
  getElevenLabsRealtimeConfig,
  isElevenLabsRealtimeProvider,
} from "@/lib";
import { UseCompletionReturn } from "@/types";
import { useMicVAD } from "@ricky0123/vad-react";
import {
  CommitStrategy,
  RealtimeConnection,
  RealtimeEvents,
  Scribe,
} from "@elevenlabs/client";
import { LoaderCircleIcon, MicIcon, MicOffIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components";
import { useApp } from "@/contexts";
import { floatArrayToWav } from "@/lib/utils";

interface AutoSpeechVADProps {
  submit: UseCompletionReturn["submit"];
  setState: UseCompletionReturn["setState"];
  setEnableVAD: UseCompletionReturn["setEnableVAD"];
  microphoneDeviceId?: string;
}

const MIC_REALTIME_SAMPLE_RATE = 16000;
const PRE_SPEECH_FRAME_LIMIT = 8;
const DEFAULT_MIC_FRAME_SAMPLES = 1536;

function float32ToPcm16Base64(frame: Float32Array): string {
  const buffer = new ArrayBuffer(frame.length * 2);
  const view = new DataView(buffer);

  for (let i = 0; i < frame.length; i++) {
    const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
    const pcm =
      sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    view.setInt16(i * 2, pcm, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function getAudioFrameChunks(
  audio: Float32Array,
  frameSize: number
): Float32Array[] {
  const chunkSize = Math.max(1, frameSize);
  const chunks: Float32Array[] = [];

  for (let index = 0; index < audio.length; index += chunkSize) {
    chunks.push(audio.slice(index, index + chunkSize));
  }

  return chunks;
}

const AutoSpeechVADInternal = ({
  submit,
  setState,
  setEnableVAD,
  microphoneDeviceId,
}: AutoSpeechVADProps) => {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const { selectedSttProvider, allSttProviders } = useApp();
  const submitRef = useRef(submit);
  const setStateRef = useRef(setState);
  const realtimeConnectionRef = useRef<RealtimeConnection | null>(null);
  const realtimeConnectionReadyRef = useRef(false);
  const realtimeQueuedFramesRef = useRef<string[]>([]);
  const realtimePreSpeechFramesRef = useRef<string[]>([]);
  const realtimeSpeechActiveRef = useRef(false);
  const realtimeCommitPendingRef = useRef(false);
  const realtimeShouldReconnectRef = useRef(false);
  const realtimeReconnectInFlightRef = useRef(false);
  const realtimeReplayCurrentSpeechRef = useRef(false);
  const micFrameSamplesRef = useRef(DEFAULT_MIC_FRAME_SAMPLES);
  const isRealtimeSttProvider = isElevenLabsRealtimeProvider(
    selectedSttProvider.provider
  );

  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    setStateRef.current = setState;
  }, [setState]);

  const setTranscriptionError = useCallback((message: string) => {
    setStateRef.current((prev: any) => ({
      ...prev,
      error: message,
    }));
  }, []);

  const closeRealtimeSession = useCallback(() => {
    realtimeShouldReconnectRef.current = false;
    realtimeReconnectInFlightRef.current = false;
    realtimeConnectionReadyRef.current = false;
    realtimeSpeechActiveRef.current = false;
    realtimeCommitPendingRef.current = false;
    realtimeReplayCurrentSpeechRef.current = false;
    realtimeQueuedFramesRef.current = [];
    realtimePreSpeechFramesRef.current = [];

    const connection = realtimeConnectionRef.current;
    realtimeConnectionRef.current = null;

    if (connection) {
      try {
        connection.close();
      } catch (error) {
        console.error("Failed to close mic realtime session:", error);
      }
    }
  }, []);

  const flushRealtimeQueue = useCallback(() => {
    const connection = realtimeConnectionRef.current;

    if (!connection || !realtimeConnectionReadyRef.current) {
      return;
    }

    while (realtimeQueuedFramesRef.current.length > 0) {
      const audioBase64 = realtimeQueuedFramesRef.current.shift();
      if (!audioBase64) {
        break;
      }

      connection.send({
        audioBase64,
        sampleRate: MIC_REALTIME_SAMPLE_RATE,
      });
    }

    if (realtimeCommitPendingRef.current) {
      realtimeCommitPendingRef.current = false;
      setIsTranscribing(true);
      connection.commit();
    }
  }, []);

  const queueRealtimeFrame = useCallback((audioBase64: string) => {
    const connection = realtimeConnectionRef.current;

    if (!connection || !realtimeConnectionReadyRef.current) {
      realtimeQueuedFramesRef.current.push(audioBase64);
      return;
    }

    connection.send({
      audioBase64,
      sampleRate: MIC_REALTIME_SAMPLE_RATE,
    });
  }, []);

  const commitRealtimeSpeech = useCallback(() => {
    const connection = realtimeConnectionRef.current;

    if (!connection || !realtimeConnectionReadyRef.current) {
      realtimeCommitPendingRef.current = true;
      return;
    }

    setIsTranscribing(true);
    connection.commit();
  }, []);

  const startRealtimeSession = useCallback(async () => {
    closeRealtimeSession();
    realtimeShouldReconnectRef.current = true;

    const { apiKey, model } = getElevenLabsRealtimeConfig(selectedSttProvider);
    const token = await fetchElevenLabsRealtimeToken(apiKey);

    const connection = Scribe.connect({
      token,
      modelId: model,
      commitStrategy: CommitStrategy.MANUAL,
      audioFormat: getElevenLabsAudioFormat(MIC_REALTIME_SAMPLE_RATE),
      sampleRate: MIC_REALTIME_SAMPLE_RATE,
    });

    realtimeConnectionRef.current = connection;
    realtimeConnectionReadyRef.current = false;
    realtimeQueuedFramesRef.current = [];
    realtimePreSpeechFramesRef.current = [];
    realtimeCommitPendingRef.current = false;

    connection.on(RealtimeEvents.OPEN, () => {
      realtimeConnectionReadyRef.current = true;
      flushRealtimeQueue();
    });

    connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {
      const text = data.text.trim();
      if (!text) {
        return;
      }

      setIsTranscribing(false);
      setStateRef.current((prev: any) => ({
        ...prev,
        error: null,
      }));
    });

    connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {
      const text = data.text.trim();
      setIsTranscribing(false);
      realtimeReplayCurrentSpeechRef.current = false;

      if (!text) {
        return;
      }

      setStateRef.current((prev: any) => ({
        ...prev,
        error: null,
      }));

      void submitRef.current(text);
    });

    connection.on(RealtimeEvents.ERROR, (data) => {
      console.error("ElevenLabs mic realtime STT error:", data);
      setIsTranscribing(false);
      realtimeReplayCurrentSpeechRef.current = true;
      setTranscriptionError(data.error || "Realtime transcription failed");
    });

    connection.on(RealtimeEvents.CLOSE, () => {
      realtimeConnectionReadyRef.current = false;

      if (realtimeConnectionRef.current === connection) {
        realtimeConnectionRef.current = null;
      }

      if (realtimeSpeechActiveRef.current || realtimeCommitPendingRef.current) {
        realtimeReplayCurrentSpeechRef.current = true;
      }

      if (
        realtimeShouldReconnectRef.current &&
        !realtimeReconnectInFlightRef.current
      ) {
        realtimeReconnectInFlightRef.current = true;

        window.setTimeout(() => {
          void startRealtimeSession()
            .catch((error) => {
              console.error(
                "Failed to restart mic realtime transcription:",
                error
              );
              setTranscriptionError(
                error instanceof Error
                  ? error.message
                  : "Failed to restart realtime transcription"
              );
            })
            .finally(() => {
              realtimeReconnectInFlightRef.current = false;
            });
        }, 0);
      }
    });
  }, [closeRealtimeSession, flushRealtimeQueue, selectedSttProvider, setTranscriptionError]);

  const ensureRealtimeSession = useCallback(async () => {
    if (!isRealtimeSttProvider) {
      return;
    }

    if (realtimeConnectionRef.current || realtimeReconnectInFlightRef.current) {
      return;
    }

    await startRealtimeSession();
  }, [isRealtimeSttProvider, startRealtimeSession]);

  const replaySpeechToRealtime = useCallback(
    async (audio: Float32Array) => {
      await ensureRealtimeSession();

      const chunks = getAudioFrameChunks(audio, micFrameSamplesRef.current);
      for (const chunk of chunks) {
        queueRealtimeFrame(float32ToPcm16Base64(chunk));
      }
    },
    [ensureRealtimeSession, queueRealtimeFrame]
  );

  useEffect(() => {
    if (!isRealtimeSttProvider) {
      closeRealtimeSession();
      return;
    }

    realtimeShouldReconnectRef.current = true;
    void ensureRealtimeSession().catch((error) => {
      console.error("Failed to start mic realtime transcription:", error);
      setTranscriptionError(
        error instanceof Error
          ? error.message
          : "Failed to start realtime transcription"
      );
    });

    return () => {
      closeRealtimeSession();
    };
  }, [closeRealtimeSession, ensureRealtimeSession, isRealtimeSttProvider, setTranscriptionError]);

  const audioConstraints: MediaTrackConstraints =
    microphoneDeviceId && microphoneDeviceId !== "default"
      ? { deviceId: { exact: microphoneDeviceId } }
      : {};

  const vad = useMicVAD({
    userSpeakingThreshold: 0.6,
    startOnLoad: true,
    additionalAudioConstraints: audioConstraints,
    onFrameProcessed: (_probabilities, frame) => {
      if (!isRealtimeSttProvider) {
        return;
      }

      micFrameSamplesRef.current = frame.length || DEFAULT_MIC_FRAME_SAMPLES;

      const audioBase64 = float32ToPcm16Base64(frame);

      if (!realtimeSpeechActiveRef.current) {
        realtimePreSpeechFramesRef.current.push(audioBase64);
        if (realtimePreSpeechFramesRef.current.length > PRE_SPEECH_FRAME_LIMIT) {
          realtimePreSpeechFramesRef.current.shift();
        }
        return;
      }

      queueRealtimeFrame(audioBase64);
    },
    onSpeechRealStart: () => {
      if (!isRealtimeSttProvider) {
        return;
      }

      realtimeSpeechActiveRef.current = true;
      realtimeReplayCurrentSpeechRef.current = false;
      void ensureRealtimeSession().catch((error) => {
        console.error("Failed to ensure mic realtime session:", error);
        setTranscriptionError(
          error instanceof Error
            ? error.message
            : "Failed to start realtime transcription"
        );
      });

      for (const audioBase64 of realtimePreSpeechFramesRef.current) {
        queueRealtimeFrame(audioBase64);
      }
      realtimePreSpeechFramesRef.current = [];
    },
    onVADMisfire: () => {
      if (!isRealtimeSttProvider) {
        return;
      }

      realtimeSpeechActiveRef.current = false;
      realtimeCommitPendingRef.current = false;
      realtimeReplayCurrentSpeechRef.current = false;
      realtimePreSpeechFramesRef.current = [];
      realtimeQueuedFramesRef.current = [];
      setIsTranscribing(false);
    },
    onSpeechEnd: async (audio) => {
      try {
        

        if (isRealtimeSttProvider ) {
          realtimeSpeechActiveRef.current = false;
          const shouldReplaySpeech =
            realtimeReplayCurrentSpeechRef.current ||
            !realtimeConnectionRef.current ||
            !realtimeConnectionReadyRef.current;
          realtimeReplayCurrentSpeechRef.current = false;
          realtimePreSpeechFramesRef.current = [];

          if (shouldReplaySpeech) {
            await replaySpeechToRealtime(audio);
          }

          commitRealtimeSpeech();
          return;
        }

        // convert float32array to blob
        const audioBlob = floatArrayToWav(audio, 16000, "wav");

        let transcription: string;

        // Check if we have a configured speech provider
        if (!selectedSttProvider.provider ) {
          console.warn("No speech provider selected");
          setStateRef.current((prev: any) => ({
            ...prev,
            error:
              "No speech provider selected. Please select one in settings.",
          }));
          return;
        }

        const providerConfig = allSttProviders.find(
          (p) => p.id === selectedSttProvider.provider
        );

        if (!providerConfig ) {
          console.warn("Selected speech provider configuration not found");
          setStateRef.current((prev: any) => ({
            ...prev,
            error:
              "Speech provider configuration not found. Please check your settings.",
          }));
          return;
        }

        setIsTranscribing(true);

        // Use the fetchSTT function for all providers
        transcription = await fetchSTT({
          provider: providerConfig,
          selectedProvider: selectedSttProvider,
          audio: audioBlob,
        });

        if (transcription) {
          await submitRef.current(transcription);
        }
      } catch (error) {
        console.error("Failed to transcribe audio:", error);
        setStateRef.current((prev: any) => ({
          ...prev,
          error:
            error instanceof Error ? error.message : "Transcription failed",
        }));
      } finally {
        setIsTranscribing(false);
      }
    },
  });

  useEffect(() => {
    realtimeShouldReconnectRef.current = vad.listening && isRealtimeSttProvider;

    if (!vad.listening) {
      closeRealtimeSession();
      return;
    }

    if (isRealtimeSttProvider) {
      void ensureRealtimeSession().catch((error) => {
        console.error("Failed to start mic realtime session:", error);
        setTranscriptionError(
          error instanceof Error
            ? error.message
            : "Failed to start realtime transcription"
        );
      });
    }
  }, [closeRealtimeSession, ensureRealtimeSession, isRealtimeSttProvider, setTranscriptionError, vad.listening]);

  return (
    <>
      <Button
        size="icon"
        aria-label="Toggle voice activity detection"
        onClick={() => {
          if (vad.listening) {
            vad.pause();
            setEnableVAD(false);
          } else {
            vad.start();
            setEnableVAD(true);
          }
        }}
        className="cursor-pointer"
      >
        {isTranscribing ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin text-green-500" />
        ) : vad.userSpeaking ? (
          <LoaderCircleIcon className="h-4 w-4 animate-spin" />
        ) : vad.listening ? (
          <MicOffIcon className="h-4 w-4 animate-pulse" />
        ) : (
          <MicIcon className="h-4 w-4" />
        )}
      </Button>
    </>
  );
};

export const AutoSpeechVAD = (props: AutoSpeechVADProps) => {
  return <AutoSpeechVADInternal key={props.microphoneDeviceId} {...props} />;
};
