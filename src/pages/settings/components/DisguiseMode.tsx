import { invoke } from "@tauri-apps/api/core";
import { Header, Label } from "@/components";
import { useEffect, useState } from "react";

const DISGUISE_STORAGE_KEY = "disguise_mode";

const DISGUISE_MODES = [
  {
    value: "auto",
    label: "Auto-rotate",
    description:
      "Cycles through benign system-app names (e.g. 'System Monitor', 'Audio Device Manager') every 30–60 s",
  },
  {
    value: "terminal",
    label: "Terminal",
    description: "Window title is fixed as 'Terminal'",
  },
  {
    value: "system_settings",
    label: "System Settings",
    description: "Window title is fixed as 'System Settings'",
  },
  {
    value: "activity_monitor",
    label: "Activity Monitor",
    description: "Window title is fixed as 'Activity Monitor'",
  },
  {
    value: "none",
    label: "None",
    description: "No title disguise — shows the real app name",
  },
] as const;

type DisguiseModeValue = (typeof DISGUISE_MODES)[number]["value"];

export const DisguiseMode = () => {
  const [mode, setMode] = useState<DisguiseModeValue>("auto");

  useEffect(() => {
    const saved = localStorage.getItem(DISGUISE_STORAGE_KEY) as DisguiseModeValue | null;
    if (saved && DISGUISE_MODES.some((m) => m.value === saved)) {
      setMode(saved);
    } else {
      invoke<string>("get_disguise_mode")
        .then((m) => setMode(m as DisguiseModeValue))
        .catch(() => {});
    }
  }, []);

  const handleChange = async (newMode: DisguiseModeValue) => {
    setMode(newMode);
    localStorage.setItem(DISGUISE_STORAGE_KEY, newMode);
    try {
      await invoke("set_disguise_mode", { mode: newMode });
    } catch (err) {
      console.error("Failed to set disguise mode:", err);
    }
  };

  return (
    <div className="space-y-4">
      <Header
        title="Window Disguise"
        description="Changes the window title shown in Task Manager and Alt+Tab to a benign system-app name, reducing the chance of detection during screen-sharing."
        isMainTitle
      />

      <div className="rounded-xl border p-4 space-y-1">
        {DISGUISE_MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => handleChange(m.value)}
            className={`w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
              mode === m.value
                ? "bg-primary/10 border border-primary/30"
                : "hover:bg-muted/60 border border-transparent"
            }`}
          >
            <div
              className={`mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors ${
                mode === m.value
                  ? "border-primary bg-primary"
                  : "border-muted-foreground"
              }`}
            />
            <div>
              <Label className="text-sm font-medium cursor-pointer">{m.label}</Label>
              <p className="text-xs text-muted-foreground mt-0.5">{m.description}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
