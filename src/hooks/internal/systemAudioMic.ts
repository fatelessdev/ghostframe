import type { MutableRefObject } from "react";
import { float32ToPcm16Base64, toErrorMessage } from "@/hooks/internal/systemAudioUtils";

export const MIC_SAMPLE_RATE = 16000;
const MIC_FRAME_SIZE = 1024;
const MIC_PREBUFFER_LIMIT = 12;

type MicCaptureRefs = {
  micMediaStreamRef: MutableRefObject<MediaStream | null>;
  micAudioContextRef: MutableRefObject<AudioContext | null>;
  micProcessorRef: MutableRefObject<ScriptProcessorNode | null>;
  micSourceNodeRef: MutableRefObject<MediaStreamAudioSourceNode | null>;
  micPreBufferRef: MutableRefObject<string[]>;
  micFrameBufferRef: MutableRefObject<Float32Array>;
  userSpeechLikelyRef: MutableRefObject<boolean>;
};

type StartMicCaptureOptions = {
  selectedInputId: string | null;
  captureRef: MutableRefObject<boolean>;
  refs: MicCaptureRefs;
  sendChunk: (chunk: { sample_rate: number; audio_base64: string }) => void;
};

type MicConstraintAttempt = {
  label: string;
  constraints: MediaStreamConstraints;
};

const buildMicConstraintAttempts = (
  selectedInputId: string | null
): MicConstraintAttempt[] => {
  const hasSpecificInput = !!selectedInputId && selectedInputId !== "default";
  const processedAudioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  const attempts: MicConstraintAttempt[] = [];

  if (hasSpecificInput) {
    attempts.push(
      {
        label: `specific:${selectedInputId}:strict`,
        constraints: {
          audio: {
            deviceId: { exact: selectedInputId },
            ...processedAudioConstraints,
            channelCount: 1,
          },
          video: false,
        },
      },
      {
        label: `specific:${selectedInputId}:relaxed`,
        constraints: {
          audio: {
            deviceId: { exact: selectedInputId },
            ...processedAudioConstraints,
          },
          video: false,
        },
      }
    );
  }

  attempts.push(
    {
      label: "default:strict",
      constraints: {
        audio: {
          ...processedAudioConstraints,
          channelCount: 1,
        },
        video: false,
      },
    },
    {
      label: "default:processed",
      constraints: {
        audio: processedAudioConstraints,
        video: false,
      },
    },
    {
      label: "default:raw",
      constraints: {
        audio: true,
        video: false,
      },
    }
  );

  return attempts;
};

const resolveMicrophoneStream = async (
  selectedInputId: string | null
): Promise<MediaStream> => {
  const attempts = buildMicConstraintAttempts(selectedInputId);
  let stream: MediaStream | null = null;
  let lastMicError: unknown = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex++) {
    const attempt = attempts[attemptIndex];

    try {
      stream = await navigator.mediaDevices.getUserMedia(attempt.constraints);
      if (attemptIndex > 0) {
        console.warn(
          `[SystemAudio] microphone fallback succeeded via ${attempt.label}`
        );
      }
      break;
    } catch (micError) {
      lastMicError = micError;
      console.warn(
        `[SystemAudio] microphone constraints failed (${attempt.label}): ${toErrorMessage(
          micError
        )}`
      );
    }
  }

  if (stream) {
    return stream;
  }

  if (lastMicError instanceof OverconstrainedError) {
    throw new Error(
      `Microphone constraints not supported (${lastMicError.constraint || "unknown"}). Try changing your input device in settings.`
    );
  }

  if (lastMicError instanceof Error) {
    throw lastMicError;
  }

  throw new Error("Failed to access microphone for realtime user transcription.");
};

export const stopMicCapture = (refs: MicCaptureRefs): void => {
  if (refs.micProcessorRef.current) {
    refs.micProcessorRef.current.disconnect();
    refs.micProcessorRef.current.onaudioprocess = null;
    refs.micProcessorRef.current = null;
  }

  if (refs.micSourceNodeRef.current) {
    refs.micSourceNodeRef.current.disconnect();
    refs.micSourceNodeRef.current = null;
  }

  if (refs.micAudioContextRef.current) {
    void refs.micAudioContextRef.current.close();
    refs.micAudioContextRef.current = null;
  }

  if (refs.micMediaStreamRef.current) {
    refs.micMediaStreamRef.current.getTracks().forEach((track) => track.stop());
    refs.micMediaStreamRef.current = null;
  }

  refs.micPreBufferRef.current = [];
  refs.micFrameBufferRef.current = new Float32Array(0);
  refs.userSpeechLikelyRef.current = false;
};

export const startMicCapture = async ({
  selectedInputId,
  captureRef,
  refs,
  sendChunk,
}: StartMicCaptureOptions): Promise<void> => {
  stopMicCapture(refs);

  const stream = await resolveMicrophoneStream(selectedInputId);
  refs.micMediaStreamRef.current = stream;

  const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
  refs.micAudioContextRef.current = context;

  const sourceNode = context.createMediaStreamSource(stream);
  refs.micSourceNodeRef.current = sourceNode;

  const processor = context.createScriptProcessor(MIC_FRAME_SIZE, 1, 1);
  refs.micProcessorRef.current = processor;

  processor.onaudioprocess = (event) => {
    if (!captureRef.current) {
      return;
    }

    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);

    let merged = new Float32Array(refs.micFrameBufferRef.current.length + copy.length);
    merged.set(refs.micFrameBufferRef.current, 0);
    merged.set(copy, refs.micFrameBufferRef.current.length);

    while (merged.length >= MIC_FRAME_SIZE) {
      const frame = merged.slice(0, MIC_FRAME_SIZE);
      merged = merged.slice(MIC_FRAME_SIZE);

      const rms = Math.sqrt(
        frame.reduce((acc, sample) => acc + sample * sample, 0) / frame.length
      );

      const frameBase64 = float32ToPcm16Base64(frame);

      if (rms > 0.01) {
        refs.userSpeechLikelyRef.current = true;
        sendChunk({
          sample_rate: MIC_SAMPLE_RATE,
          audio_base64: frameBase64,
        });
      } else if (refs.userSpeechLikelyRef.current) {
        refs.micPreBufferRef.current.push(frameBase64);
        if (refs.micPreBufferRef.current.length > MIC_PREBUFFER_LIMIT) {
          refs.micPreBufferRef.current.shift();
        }

        for (const buffered of refs.micPreBufferRef.current) {
          sendChunk({
            sample_rate: MIC_SAMPLE_RATE,
            audio_base64: buffered,
          });
        }

        refs.micPreBufferRef.current = [];
        refs.userSpeechLikelyRef.current = false;
      }
    }

    refs.micFrameBufferRef.current = merged;
  };

  sourceNode.connect(processor);
  processor.connect(context.destination);
};

export type { MicCaptureRefs };
