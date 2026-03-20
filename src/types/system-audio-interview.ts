export type TranscriptSource = "interviewer" | "user";

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
}
