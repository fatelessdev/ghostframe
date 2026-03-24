import { SettingsIcon } from "lucide-react";

interface OverlayTopBarProps {
  screenshotCount: number;
  mode: "D" | "P";
  isCapturing: boolean;
  onStartInterview: () => void;
  onOpenSettings?: () => void;
  onToggleMode?: () => void;
}

export const OverlayTopBar = ({
  screenshotCount,
  mode,
  isCapturing,
  onStartInterview,
  onOpenSettings,
  onToggleMode,
}: OverlayTopBarProps) => {
  // Shared styles for secondary action buttons
  const secondaryButtonBase = `
    group relative flex items-center justify-center gap-1.5
    text-white/84
    min-w-[4.6rem] px-2.5 py-1.5
    rounded-xl
    transition-all duration-200 ease-out
    hover:text-white/92 hover:bg-white/[0.06]
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
            flex items-center justify-center gap-1.5
            text-blue-300/95 hover:text-blue-200
            px-3 py-1.5 rounded-xl
            transition-all duration-200 ease-out
            hover:bg-blue-500/16
            active:scale-[0.98]
            focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400/40
          "
          aria-label={`Mode: ${mode === "P" ? "Pro" : "Fast"}. Click to toggle.`}
        >
          <span className="text-[12px] font-medium tracking-wide">
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
            aria-label="Take screenshot"
          >
            <span className="text-[11px] font-medium tracking-wide">Screenshot</span>
            {screenshotCount > 0 ? (
              <span
                className="absolute -top-1 -right-1 inline-flex min-w-[1.1rem] h-[1.1rem] items-center justify-center rounded-full bg-blue-500/90 px-1 text-[9px] font-semibold text-white shadow-md shadow-blue-500/30"
                aria-label={`${screenshotCount} screenshots attached`}
              >
                {screenshotCount}
              </span>
            ) : null}
          </button>

          <button
            className={secondaryButtonBase}
            aria-label="Solve problem"
          >
            <span className="text-[11px] font-medium tracking-wide">Solve</span>
          </button>

          <button
            className={secondaryButtonBase}
            aria-label="Toggle panel visibility"
          >
            <span className="text-[11px] font-medium tracking-wide">Toggle</span>
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
