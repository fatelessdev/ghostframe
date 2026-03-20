import { Header, Label, Slider, Switch, Textarea, Input } from "@/components";
import { useMemo, useState } from "react";
import {
  getSystemAudioInterviewSettings,
  updateSystemAudioInterviewSettings,
} from "@/lib";
import { DEFAULT_QUICK_ACTIONS } from "@/config";

const clampManualScreenshotLimit = (value: number): number => {
  return Math.max(1, Math.min(8, Math.round(value)));
};

export const SystemAudioInterviewSettings = () => {
  const [settings, setSettings] = useState(() =>
    getSystemAudioInterviewSettings()
  );
  const [newQuickAction, setNewQuickAction] = useState("");

  const quickActionCount = useMemo(() => settings.quickActions.length, [
    settings.quickActions,
  ]);

  const applySettings = (updates: Partial<typeof settings>) => {
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

        <div className="space-y-2">
          <Label className="text-xs font-medium">Max manual screenshots per send</Label>
          <div className="flex items-center gap-3">
            <Slider
              value={[settings.maxManualScreenshots]}
              min={1}
              max={8}
              step={1}
              onValueChange={([value]) => {
                applySettings({
                  maxManualScreenshots: clampManualScreenshotLimit(value),
                });
              }}
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
            <div className="flex items-center justify-between text-xs">
              <span>Speech sensitivity</span>
              <span className="text-muted-foreground">
                {(settings.vadConfig.sensitivity_rms * 1000).toFixed(1)}
              </span>
            </div>
            <Slider
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
            />
          </div>
        </div>
      </div>
    </div>
  );
};
