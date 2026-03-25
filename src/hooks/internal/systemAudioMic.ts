import type { MutableRefObject } from "react";
import {
  float32ToPcm16Base64,
  pcm16BufferToBase64,
  toErrorMessage,
} from "@/hooks/internal/systemAudioUtils";

export const MIC_SAMPLE_RATE = 16000;
const MIC_FRAME_SIZE = 1024;
const MIC_PREBUFFER_LIMIT = 12;
const MIC_RMS_THRESHOLD = 0.01;
const MIC_WORKLET_PROCESSOR_NAME = "ghostframe-mic-processor";
const MIC_WORKLET_MODULE_URL = new URL(
  "./systemAudioMic.worklet.js",
  import.meta.url
).href;

type MicCaptureRefs = {
  micMediaStreamRef: MutableRefObject<MediaStream | null>;
  micAudioContextRef: MutableRefObject<AudioContext | null>;
  micWorkletNodeRef: MutableRefObject<AudioWorkletNode | null>;
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

type MicWorkletFrameMessage = {
  type: "frame";
  pcm16: ArrayBuffer;
  rms: number;
};

const isMicWorkletFrameMessage = (
  value: unknown
): value is MicWorkletFrameMessage => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MicWorkletFrameMessage>;
  return (
    candidate.type === "frame" &&
    candidate.pcm16 instanceof ArrayBuffer &&
    typeof candidate.rms === "number"
  );
};

const sendMicFrameWithVad = (
  refs: MicCaptureRefs,
  sendChunk: (chunk: { sample_rate: number; audio_base64: string }) => void,
  frameBase64: string,
  rms: number
): void => {
  if (rms > MIC_RMS_THRESHOLD) {
    refs.userSpeechLikelyRef.current = true;
    sendChunk({
      sample_rate: MIC_SAMPLE_RATE,
      audio_base64: frameBase64,
    });
    return;
  }

  if (!refs.userSpeechLikelyRef.current) {
    return;
  }

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
};

const startMicAudioWorkletCapture = async (
  context: AudioContext,
  sourceNode: MediaStreamAudioSourceNode,
  captureRef: MutableRefObject<boolean>,
  refs: MicCaptureRefs,
  sendChunk: (chunk: { sample_rate: number; audio_base64: string }) => void
): Promise<boolean> => {
  if (!context.audioWorklet) {
    return false;
  }

  try {
    await context.audioWorklet.addModule(MIC_WORKLET_MODULE_URL);

    const workletNode = new AudioWorkletNode(context, MIC_WORKLET_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });

    refs.micWorkletNodeRef.current = workletNode;

    workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
      if (!captureRef.current) {
        return;
      }

      if (!isMicWorkletFrameMessage(event.data)) {
        return;
      }

      const frameBase64 = pcm16BufferToBase64(event.data.pcm16);
      if (!frameBase64) {
        return;
      }

      sendMicFrameWithVad(refs, sendChunk, frameBase64, event.data.rms);
    };

    sourceNode.connect(workletNode);
    return true;
  } catch (workletError) {
    console.warn(
      `[SystemAudio] microphone AudioWorklet unavailable, falling back to ScriptProcessorNode: ${toErrorMessage(
        workletError
      )}`
    );

    if (refs.micWorkletNodeRef.current) {
      refs.micWorkletNodeRef.current.port.onmessage = null;
      refs.micWorkletNodeRef.current.disconnect();
      refs.micWorkletNodeRef.current = null;
    }

    return false;
  }
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
  if (refs.micWorkletNodeRef.current) {
    refs.micWorkletNodeRef.current.port.onmessage = null;
    refs.micWorkletNodeRef.current.disconnect();
    refs.micWorkletNodeRef.current = null;
  }

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

const sendScriptProcessorFrame = (
  refs: MicCaptureRefs,
  sendChunk: (chunk: { sample_rate: number; audio_base64: string }) => void,
  frame: Float32Array
): void => {
  let energy = 0;
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i];
    energy += sample * sample;
  }

  const rms = Math.sqrt(energy / frame.length);
  const frameBase64 = float32ToPcm16Base64(frame);
  sendMicFrameWithVad(refs, sendChunk, frameBase64, rms);
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

  const startedWithWorklet = await startMicAudioWorkletCapture(
    context,
    sourceNode,
    captureRef,
    refs,
    sendChunk
  );

  if (startedWithWorklet) {
    return;
  }

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
      sendScriptProcessorFrame(refs, sendChunk, frame);
    }

    refs.micFrameBufferRef.current = merged;
  };

  sourceNode.connect(processor);
  processor.connect(context.destination);
};

export type { MicCaptureRefs };
