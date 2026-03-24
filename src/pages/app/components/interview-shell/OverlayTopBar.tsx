import { SettingsIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

interface OverlayTopBarProps {
  screenshotCount: number;
  mode: "D" | "P";
  isCapturing: boolean;
  onStartInterview: () => void;
  onOpenSettings?: () => void;
  onToggleMode?: () => void;
}

export const OverlayTopBar = ({
  mode,
  isCapturing,
  onStartInterview,
  onOpenSettings,
  onToggleMode,
}: OverlayTopBarProps) => {
  // Shared styles for secondary action buttons
  const secondaryButtonBase = `
    group flex items-center gap-1.5
    text-white/50 
    px-2.5 py-1.5 
    rounded-lg
    transition-all duration-200 ease-out
    hover:text-white/80 hover:bg-white/[0.04]
    active:bg-white/[0.06] active:scale-[0.99]
    focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/40
  `;

  return (
    <header
      className="flex items-center justify-center pointer-events-none cursor-move"
      data-tauri-drag-region
    >
      {/* Glassmorphic floating bar using CSS variables from globals.css */}
      <nav
        className="
          font-abel
          flex items-center
          overlay-panel-glass
          rounded-2xl
          pl-1.5 pr-1 py-1
          gap-0.5
          pointer-events-auto
          shadow-lg shadow-black/20
          border border-[--overlay-border-soft]
          transition-all duration-300 ease-out
          hover:border-[--overlay-border-highlight]
          motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-500
        "
        role="toolbar"
        aria-label="Interview controls"
      >
        {/* Mode toggle - uses blue accent */}
        <button
          onClick={onToggleMode}
          className="
            flex items-center gap-1
            text-blue-400 hover:text-blue-300
            px-3 py-1.5 rounded-xl
            transition-all duration-200 ease-out
            hover:bg-blue-500/10
            active:scale-[0.98]
            focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/40
          "
          aria-label={`Mode: ${mode === "P" ? "Pro" : "Fast"}. Click to toggle.`}
        >
          <span className="text-[12px] tracking-wide">
            {mode === "P" ? "Pro" : "Fast"}
          </span>
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-gradient-to-b from-transparent via-white/[0.08] to-transparent mx-0.5" aria-hidden="true" />

        {/* Start/Stop - Primary CTA using blue accent */}
        <button
          onClick={onStartInterview}
          className={`
            relative flex items-center justify-center
            min-w-[4.5rem] px-4 py-1.5 rounded-xl
            text-[12px] font-medium tracking-wide
            transition-all duration-200 ease-out
            active:scale-[0.98]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-black/40
            ${
              isCapturing
                ? "bg-red-500/80 text-white hover:bg-red-500/90 focus-visible:ring-red-400/60"
                : "bg-blue-500/80 text-white hover:bg-blue-500/90 focus-visible:ring-blue-400/60"
            }
          `}
          aria-pressed={isCapturing}
          aria-label={isCapturing ? "Stop interview" : "Start interview"}
        >
          {isCapturing ? "Stop" : "Start"}
        </button>

        {/* Divider */}
        <div className="w-px h-4 bg-gradient-to-b from-transparent via-white/[0.08] to-transparent mx-0.5" aria-hidden="true" />

        {/* Secondary actions */}
        <div className="flex items-center gap-px">
          <button
            className={secondaryButtonBase}
            aria-label="Take screenshot. Shortcut: Control plus H"
          >
            <span className="text-[11px]">Screenshot</span>
            <Kbd size="sm" variant="ghost">Ctrl+H</Kbd>
          </button>

          <button
            className={secondaryButtonBase}
            aria-label="Solve problem. Shortcut: Control plus Enter"
          >
            <span className="text-[11px]">Solve</span>
            <Kbd size="sm" variant="ghost">Ctrl+↵</Kbd>
          </button>

          <button
            className={secondaryButtonBase}
            aria-label="Toggle panel visibility. Shortcut: Control plus forward slash"
          >
            <span className="text-[11px]">Toggle</span>
            <Kbd size="sm" variant="ghost">Ctrl+/</Kbd>
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-gradient-to-b from-transparent via-white/[0.08] to-transparent mx-0.5" aria-hidden="true" />

        {/* Settings */}
        <button
          onClick={onOpenSettings}
          className="
            flex items-center justify-center
            w-8 h-8
            text-white/35 hover:text-white/70
            hover:bg-white/[0.04]
            active:bg-white/[0.06]
            transition-all duration-200 ease-out
            rounded-xl
            focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/40
            group
          "
          aria-label="Open settings"
        >
          <SettingsIcon 
            className="w-3.5 h-3.5 transition-transform duration-500 ease-out group-hover:rotate-90" 
            strokeWidth={1.5} 
          />
        </button>
      </nav>
    </header>
  );
};
