import {
  CameraIcon,
  GripVerticalIcon,
  SettingsIcon,
  ShieldIcon,
} from "lucide-react";
import { Badge } from "@/components";

interface OverlayTopBarProps {
  screenshotCount: number;
  mode: "D" | "P";
  contentProtectionEnabled: boolean;
  isCapturing: boolean;
  onStartInterview: () => void;
  onOpenSettings: () => void;
  onDragHandleClick?: () => void;
}

const getScreenshotBadgeLabel = (count: number): string => {
  if (count > 99) {
    return "99+";
  }

  return String(count);
};

export const OverlayTopBar = ({
  screenshotCount,
  mode,
  contentProtectionEnabled,
  isCapturing,
  onStartInterview,
  onOpenSettings,
}: OverlayTopBarProps) => {
  const screenshotLabel =
    screenshotCount > 0
      ? `Screenshots captured: ${getScreenshotBadgeLabel(screenshotCount)}`
      : "No screenshots captured";

  const contentProtectionLabel = contentProtectionEnabled
    ? "Content protection is enabled"
    : "Content protection is disabled";

  return (
    <header className="overlay-top-bar-glass flex items-center justify-between gap-2 px-3 py-2 pointer-events-none">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 pointer-events-auto"
          onClick={onStartInterview}
          aria-label={isCapturing ? "Stop Interview" : "Start Interview"}
        >
          {isCapturing ? "Stop Interview" : "Start Interview"}
        </button>

        <div
          className="overlay-top-bar-control inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border text-muted-foreground pointer-events-auto cursor-grab active:cursor-grabbing"
          aria-label="Drag handle"
          data-tauri-drag-region
        >
          <GripVerticalIcon className="h-4 w-4 pointer-events-none" />
        </div>

        <button
          type="button"
          className="overlay-top-bar-control inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground pointer-events-auto"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="overlay-top-bar-control relative inline-flex min-h-8 min-w-8 items-center justify-center overflow-visible rounded-xl border text-muted-foreground pointer-events-none"
          role="status"
          aria-label={screenshotLabel}
        >
          <CameraIcon className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{screenshotLabel}</span>
          {screenshotCount > 0 ? (
            <Badge
              variant="outline"
              className="absolute -right-1 -top-1 z-20 h-5 min-w-5 rounded-full border-border/60 bg-background/85 px-1 text-[10px] font-semibold leading-none text-foreground shadow-sm backdrop-blur-md"
            >
              {getScreenshotBadgeLabel(screenshotCount)}
            </Badge>
          ) : null}
        </div>

        <span className="overlay-top-bar-control inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border px-2 text-xs font-semibold text-muted-foreground pointer-events-none">
          {mode}
        </span>

        <span
          className={`overlay-top-bar-control inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border pointer-events-none ${
            contentProtectionEnabled ? "text-red-400" : "text-muted-foreground"
          }`}
          aria-label={contentProtectionLabel}
        >
          <ShieldIcon className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{contentProtectionLabel}</span>
        </span>
      </div>
    </header>
  );
};
