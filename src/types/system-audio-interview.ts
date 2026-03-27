export type TranscriptSource = "interviewer" | "user";

export type TranscriptStability = "interim" | "optimistic" | "final";

export interface SystemAudioVadConfig {
  enabled: boolean;
  hop_size: number;
  sensitivity_rms: number;
  peak_threshold: number;
  silence_chunks: number;
  min_speech_chunks: number;
  pre_speech_chunks: number;
  noise_gate_threshold: number;
  max_recording_duration_secs: number;
}

export interface SystemAudioInterviewSettings {
  useSystemPrompt: boolean;
  contextContent: string;
  tailoringEnabled: boolean;
  resumeSummary: string;
  jobDescriptionSummary: string;
  quickActions: string[];
  maxManualScreenshots: number;
  vadConfig: SystemAudioVadConfig;
}

export interface TranscriptSegment {
  id: string;
  source: TranscriptSource;
  text: string;
  timestamp: number;
  isLive: boolean;
  stability: TranscriptStability;
}

export type SystemAudioLatencyStage =
  | "answer_trigger"
  | "realtime_ws_received"
  | "transcript_finalized"
  | "prompt_assembled"
  | "llm_request_dispatched"
  | "llm_first_chunk"
  | "llm_stream_done"
  | "llm_error";

export interface SystemAudioLatencyMetric {
  latest: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface SystemAudioLatencySnapshot {
  startedAt: number;
  sampleCount: number;
  answerTriggerToTranscriptFinalizedMs: SystemAudioLatencyMetric;
  transcriptFinalizedToPromptMs: SystemAudioLatencyMetric;
  answerTriggerToPromptMs: SystemAudioLatencyMetric;
  promptToDispatchMs: SystemAudioLatencyMetric;
  dispatchToFirstChunkMs: SystemAudioLatencyMetric;
  answerTriggerToFirstChunkMs: SystemAudioLatencyMetric;
  answerTriggerToDoneMs: SystemAudioLatencyMetric;
  promptToFirstChunkMs: SystemAudioLatencyMetric;
  firstChunkToDoneMs: SystemAudioLatencyMetric;
}
