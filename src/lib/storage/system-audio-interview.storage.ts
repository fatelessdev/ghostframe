import { DEFAULT_QUICK_ACTIONS, STORAGE_KEYS } from "@/config";
import { safeLocalStorage } from "./helper";
import {
  SystemAudioInterviewSettings,
  SystemAudioVadConfig,
} from "@/types/system-audio-interview";

const DEFAULT_VAD_CONFIG: SystemAudioVadConfig = {
  enabled: true,
  hop_size: 1024,
  sensitivity_rms: 0.012,
  peak_threshold: 0.035,
  silence_chunks: 24,
  min_speech_chunks: 7,
  pre_speech_chunks: 8,
  noise_gate_threshold: 0.003,
  max_recording_duration_secs: 180,
};

export const DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS: SystemAudioInterviewSettings =
  {
    useSystemPrompt: true,
    contextContent: "",
    quickActions: DEFAULT_QUICK_ACTIONS,
    maxManualScreenshots: 4,
    vadConfig: DEFAULT_VAD_CONFIG,
  };

function parseLegacyContext(): {
  useSystemPrompt: boolean;
  contextContent: string;
} {
  const savedContext = safeLocalStorage.getItem(STORAGE_KEYS.SYSTEM_AUDIO_CONTEXT);

  if (!savedContext) {
    return {
      useSystemPrompt: DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.useSystemPrompt,
      contextContent: DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.contextContent,
    };
  }

  try {
    const parsed = JSON.parse(savedContext);
    return {
      useSystemPrompt:
        typeof parsed.useSystemPrompt === "boolean"
          ? parsed.useSystemPrompt
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.useSystemPrompt,
      contextContent:
        typeof parsed.contextContent === "string"
          ? parsed.contextContent
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.contextContent,
    };
  } catch {
    return {
      useSystemPrompt: DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.useSystemPrompt,
      contextContent: DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.contextContent,
    };
  }
}

function parseLegacyQuickActions(): string[] {
  const savedActions = safeLocalStorage.getItem(
    STORAGE_KEYS.SYSTEM_AUDIO_QUICK_ACTIONS
  );

  if (!savedActions) {
    return DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.quickActions;
  }

  try {
    const parsed = JSON.parse(savedActions);
    if (Array.isArray(parsed)) {
      const normalized = parsed
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (normalized.length > 0) {
        return normalized;
      }
    }
  } catch {
    // fallback
  }

  return DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.quickActions;
}

function parseLegacyVadConfig(): SystemAudioVadConfig {
  const savedVadConfig = safeLocalStorage.getItem("vad_config");
  if (!savedVadConfig) {
    return DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig;
  }

  try {
    const parsed = JSON.parse(savedVadConfig);
    if (!parsed || typeof parsed !== "object") {
      return DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig;
    }

    return {
      enabled:
        typeof parsed.enabled === "boolean"
          ? parsed.enabled
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.enabled,
      hop_size:
        typeof parsed.hop_size === "number"
          ? parsed.hop_size
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.hop_size,
      sensitivity_rms:
        typeof parsed.sensitivity_rms === "number"
          ? parsed.sensitivity_rms
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.sensitivity_rms,
      peak_threshold:
        typeof parsed.peak_threshold === "number"
          ? parsed.peak_threshold
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.peak_threshold,
      silence_chunks:
        typeof parsed.silence_chunks === "number"
          ? parsed.silence_chunks
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.silence_chunks,
      min_speech_chunks:
        typeof parsed.min_speech_chunks === "number"
          ? parsed.min_speech_chunks
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.min_speech_chunks,
      pre_speech_chunks:
        typeof parsed.pre_speech_chunks === "number"
          ? parsed.pre_speech_chunks
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.pre_speech_chunks,
      noise_gate_threshold:
        typeof parsed.noise_gate_threshold === "number"
          ? parsed.noise_gate_threshold
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig.noise_gate_threshold,
      max_recording_duration_secs:
        typeof parsed.max_recording_duration_secs === "number"
          ? parsed.max_recording_duration_secs
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig
              .max_recording_duration_secs,
    };
  } catch {
    return DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig;
  }
}

function migrateLegacySettings(): SystemAudioInterviewSettings {
  const legacyContext = parseLegacyContext();
  const legacyQuickActions = parseLegacyQuickActions();
  const legacyVadConfig = parseLegacyVadConfig();

  const migrated: SystemAudioInterviewSettings = {
    ...DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS,
    useSystemPrompt: legacyContext.useSystemPrompt,
    contextContent: legacyContext.contextContent,
    quickActions: legacyQuickActions,
    vadConfig: legacyVadConfig,
  };

  safeLocalStorage.setItem(
    STORAGE_KEYS.SYSTEM_AUDIO_INTERVIEW_SETTINGS,
    JSON.stringify(migrated)
  );

  return migrated;
}

export function getSystemAudioInterviewSettings(): SystemAudioInterviewSettings {
  const stored = safeLocalStorage.getItem(
    STORAGE_KEYS.SYSTEM_AUDIO_INTERVIEW_SETTINGS
  );

  if (!stored) {
    return migrateLegacySettings();
  }

  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") {
      return migrateLegacySettings();
    }

    return {
      useSystemPrompt:
        typeof parsed.useSystemPrompt === "boolean"
          ? parsed.useSystemPrompt
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.useSystemPrompt,
      contextContent:
        typeof parsed.contextContent === "string"
          ? parsed.contextContent
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.contextContent,
      quickActions: Array.isArray(parsed.quickActions)
        ? parsed.quickActions
            .filter((entry: unknown) => typeof entry === "string")
            .map((entry: string) => entry.trim())
            .filter(Boolean)
        : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.quickActions,
      maxManualScreenshots:
        typeof parsed.maxManualScreenshots === "number" &&
        parsed.maxManualScreenshots >= 1 &&
        parsed.maxManualScreenshots <= 8
          ? parsed.maxManualScreenshots
          : DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.maxManualScreenshots,
      vadConfig: {
        ...DEFAULT_SYSTEM_AUDIO_INTERVIEW_SETTINGS.vadConfig,
        ...(parsed.vadConfig && typeof parsed.vadConfig === "object"
          ? parsed.vadConfig
          : {}),
      },
    };
  } catch {
    return migrateLegacySettings();
  }
}

export function updateSystemAudioInterviewSettings(
  updates: Partial<SystemAudioInterviewSettings>
): SystemAudioInterviewSettings {
  const current = getSystemAudioInterviewSettings();

  const next: SystemAudioInterviewSettings = {
    ...current,
    ...updates,
    vadConfig: {
      ...current.vadConfig,
      ...(updates.vadConfig ?? {}),
    },
  };

  safeLocalStorage.setItem(
    STORAGE_KEYS.SYSTEM_AUDIO_INTERVIEW_SETTINGS,
    JSON.stringify(next)
  );

  window.dispatchEvent(
    new CustomEvent("systemAudioInterviewSettingsChanged", {
      detail: next,
    })
  );

  return next;
}
