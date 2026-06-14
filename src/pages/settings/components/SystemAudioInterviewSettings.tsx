import { Header, Label, Slider, Switch, Textarea, Input } from "@/components";
import { tauriCommands } from "@/lib";
import { useEffect, useMemo, useState } from "react";
import {
  getSystemAudioInterviewSettings,
  updateSystemAudioInterviewSettings,
} from "@/lib";
import { DEFAULT_QUICK_ACTIONS } from "@/config";

const clampManualScreenshotLimit = (value: number): number => {
  return Math.max(1, Math.min(8, Math.round(value)));
};

const TAILORING_HELPER_PROMPT = `You are helping me prepare interview personalization notes.

I will provide:
1) My resume
2) The target job description

Return exactly two concise sections:

[RESUME_SUMMARY]
- 8-15 bullets with facts I can credibly claim in interviews (skills, projects, measurable impact, domain experience, leadership, tools, constraints handled).
- Keep each bullet short and specific.
- No fluff.

[JOB_DESCRIPTION_SUMMARY]
- 8-15 bullets covering what this role prioritizes (required skills, responsibilities, domain focus, collaboration expectations, seniority signals, stack).
- Include implicit expectations if obvious from context.

Style constraints:
- Plain text only.
- No markdown tables.
- No intro/conclusion.
- Keep both sections practical for tailoring live interview answers.`;

export const SystemAudioInterviewSettings = () => {
  const [settings, setSettings] = useState(() =>
    getSystemAudioInterviewSettings()
  );
  const [newQuickAction, setNewQuickAction] = useState("");
  const [copyPromptState, setCopyPromptState] = useState<
    "idle" | "copied" | "failed"
  >("idle");

  useEffect(() => {
    const syncSettings = () => {
      setSettings(getSystemAudioInterviewSettings());
    };

    window.addEventListener("systemAudioInterviewSettingsChanged", syncSettings);
    window.addEventListener("storage", syncSettings);

    return () => {
      window.removeEventListener(
        "systemAudioInterviewSettingsChanged",
        syncSettings
      );
      window.removeEventListener("storage", syncSettings);
    };
  }, []);

  const quickActionCount = useMemo(() => settings.quickActions.length, [
    settings.quickActions,
  ]);

  const applySettings = (updates: Partial<typeof settings>) => {
    if (updates.vadConfig) {
      const next = {
        ...settings,
        ...updates,
        vadConfig: {
          ...settings.vadConfig,
          ...updates.vadConfig,
        },
      };

      void tauriCommands.updateVadConfig(next.vadConfig).then(() => {
        const stored = updateSystemAudioInterviewSettings(updates);
        setSettings(stored);
      }).catch((error) => {
        console.warn("Failed to sync VAD config with backend:", error);
      });
      return;
    }

    const next = updateSystemAudioInterviewSettings(updates);
    setSettings(next);
  };

  const addQuickAction = () => {
    const value = newQuickAction.trim();
    if (!value || settings.quickActions.includes(value)) {
      return;
    }

    applySettings({ quickActions: [...settings.quickActions, value] });
    setNewQuickAction("");
  };

  const removeQuickAction = (action: string) => {
    applySettings({
      quickActions: settings.quickActions.filter((entry) => entry !== action),
    });
  };

  const handleCopyTailoringPrompt = async () => {
    try {
      await navigator.clipboard.writeText(TAILORING_HELPER_PROMPT);
      setCopyPromptState("copied");
      window.setTimeout(() => {
        setCopyPromptState("idle");
      }, 1800);
    } catch (error) {
      console.warn("Failed to copy tailoring helper prompt:", error);
      setCopyPromptState("failed");
      window.setTimeout(() => {
        setCopyPromptState("idle");
      }, 2200);
    }
  };

  return (
    <div id="system-audio-interview" className="space-y-4">
      <Header
        title="System Audio Interview"
        description="Configure the low-latency interview flow: dual transcripts, manual send trigger, and screenshot context."
        isMainTitle
      />

      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Use global system prompt</Label>
            <p className="text-xs text-muted-foreground mt-1">
              When enabled, System Audio mode uses the default prompt from settings.
            </p>
          </div>
          <Switch
            checked={settings.useSystemPrompt}
            onCheckedChange={(checked) => applySettings({ useSystemPrompt: checked })}
          />
        </div>

        {!settings.useSystemPrompt ? (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Custom interview context</Label>
            <Textarea
              value={settings.contextContent}
              onChange={(event) =>
                applySettings({ contextContent: event.target.value })
              }
              placeholder="Paste role/company context, resume highlights, or interview constraints..."
              className="min-h-24 resize-y"
            />
          </div>
        ) : null}

        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Interview tailoring</Label>
            <p className="text-xs text-muted-foreground">
              Add your resume summary and job description summary so Start-mode
              answers stay personalized and authentic.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Summary helper prompt</Label>
            <p className="text-[11px] text-muted-foreground">
              Paste this into another AI tool with your resume and JD. Then copy
              the generated summaries into the fields below.
            </p>
            <Textarea
              value={TAILORING_HELPER_PROMPT}
              readOnly
              className="min-h-36 resize-y text-[11px]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleCopyTailoringPrompt();
                }}
                className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted"
              >
                Copy Prompt
              </button>
              <span className="text-[11px] text-muted-foreground">
                {copyPromptState === "copied"
                  ? "Copied"
                  : copyPromptState === "failed"
                    ? "Copy failed"
                    : ""}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-2">
            <div>
              <Label className="text-sm font-medium">
                Enable tailoring context
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                When on, these summaries are appended to interview prompts.
              </p>
            </div>
            <Switch
              checked={settings.tailoringEnabled}
              onCheckedChange={(checked) =>
                applySettings({ tailoringEnabled: checked })
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Resume summary</Label>
            <Textarea
              value={settings.resumeSummary}
              onChange={(event) =>
                applySettings({ resumeSummary: event.target.value })
              }
              placeholder="Paste the final summary of your background, projects, strengths, and measurable impact..."
              className="min-h-24 resize-y"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">Job description summary</Label>
            <Textarea
              value={settings.jobDescriptionSummary}
              onChange={(event) =>
                applySettings({ jobDescriptionSummary: event.target.value })
              }
              placeholder="Paste the summarized role expectations, required skills, priorities, and stack..."
              className="min-h-24 resize-y"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">Max manual screenshots per send</Label>
          <div className="flex items-center gap-3">
            <Slider
              aria-label="Max manual screenshots per send"
              value={[settings.maxManualScreenshots]}
              min={1}
              max={8}
              step={1}
              onValueChange={([value]) => {
                applySettings({
                  maxManualScreenshots: clampManualScreenshotLimit(value),
                });
              }}
              aria-label="Max manual screenshots per send"
            />
            <span className="w-10 text-xs text-muted-foreground text-right">
              {settings.maxManualScreenshots}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Oldest manual screenshot is replaced automatically if the limit is reached.
          </p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-medium">Quick actions ({quickActionCount})</Label>
          <div className="flex flex-wrap gap-2">
            {settings.quickActions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => removeQuickAction(action)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs hover:bg-muted"
                title="Remove quick action"
              >
                {action}
                <span className="text-muted-foreground">x</span>
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              value={newQuickAction}
              onChange={(event) => setNewQuickAction(event.target.value)}
              placeholder="Add quick action"
              className="h-8 text-xs"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addQuickAction();
                }
              }}
            />
            <button
              type="button"
              onClick={addQuickAction}
              className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => applySettings({ quickActions: DEFAULT_QUICK_ACTIONS })}
              className="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted"
            >
              Reset
            </button>
          </div>
        </div>

        <div className="space-y-3 border-t border-border/60 pt-3">
          <Label className="text-xs font-medium">Speech detection tuning</Label>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-sm font-medium">Enable VAD</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Turn voice activity detection on or off for system audio capture.
                </p>
              </div>
              <Switch
                checked={settings.vadConfig.enabled}
                onCheckedChange={(checked) => {
                  applySettings({
                    vadConfig: {
                      ...settings.vadConfig,
                      enabled: checked,
                    },
                  });
                }}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Speech sensitivity</span>
              <span className="text-muted-foreground">
                {(settings.vadConfig.sensitivity_rms * 1000).toFixed(1)}
              </span>
            </div>
            <Slider
              aria-label="Speech sensitivity"
              value={[settings.vadConfig.sensitivity_rms * 1000]}
              min={1}
              max={20}
              step={0.5}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    sensitivity_rms: value / 1000,
                  },
                });
              }}
              aria-label="Speech sensitivity"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Peak threshold</span>
              <span className="text-muted-foreground">
                {(settings.vadConfig.peak_threshold * 1000).toFixed(1)}
              </span>
            </div>
            <Slider
              aria-label="Peak threshold"
              value={[settings.vadConfig.peak_threshold * 1000]}
              min={5}
              max={100}
              step={0.5}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    peak_threshold: value / 1000,
                  },
                });
              }}
              aria-label="Peak threshold"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Hop size</span>
              <span className="text-muted-foreground">
                {settings.vadConfig.hop_size} samples
              </span>
            </div>
            <Slider
              aria-label="Hop size"
              value={[settings.vadConfig.hop_size]}
              min={256}
              max={4096}
              step={256}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    hop_size: Math.round(value),
                  },
                });
              }}
              aria-label="Hop size"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Silence chunks</span>
              <span className="text-muted-foreground">
                {settings.vadConfig.silence_chunks}
              </span>
            </div>
            <Slider
              aria-label="Silence chunks"
              value={[settings.vadConfig.silence_chunks]}
              min={1}
              max={60}
              step={1}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    silence_chunks: Math.round(value),
                  },
                });
              }}
              aria-label="Silence chunks"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Minimum speech chunks</span>
              <span className="text-muted-foreground">
                {settings.vadConfig.min_speech_chunks}
              </span>
            </div>
            <Slider
              aria-label="Minimum speech chunks"
              value={[settings.vadConfig.min_speech_chunks]}
              min={1}
              max={20}
              step={1}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    min_speech_chunks: Math.round(value),
                  },
                });
              }}
              aria-label="Min speech chunks"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Pre-speech chunks</span>
              <span className="text-muted-foreground">
                {settings.vadConfig.pre_speech_chunks}
              </span>
            </div>
            <Slider
              aria-label="Pre-speech chunks"
              value={[settings.vadConfig.pre_speech_chunks]}
              min={0}
              max={20}
              step={1}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    pre_speech_chunks: Math.round(value),
                  },
                });
              }}
              aria-label="Pre-speech chunks"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Max recording duration</span>
              <span className="text-muted-foreground">
                {settings.vadConfig.max_recording_duration_secs}s
              </span>
            </div>
            <Slider
              aria-label="Max recording duration"
              value={[settings.vadConfig.max_recording_duration_secs]}
              min={30}
              max={3600}
              step={30}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    max_recording_duration_secs: Math.round(value),
                  },
                });
              }}
              aria-label="Max recording duration"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>Noise gate</span>
              <span className="text-muted-foreground">
                {(settings.vadConfig.noise_gate_threshold * 1000).toFixed(1)}
              </span>
            </div>
            <Slider
              aria-label="Noise gate"
              value={[settings.vadConfig.noise_gate_threshold * 1000]}
              min={0}
              max={10}
              step={0.1}
              onValueChange={([value]) => {
                applySettings({
                  vadConfig: {
                    ...settings.vadConfig,
                    noise_gate_threshold: value / 1000,
                  },
                });
              }}
              aria-label="Noise gate threshold"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
