import {
  CameraIcon,
  GripVerticalIcon,
  SettingsIcon,
  ShieldIcon,
} from "lucide-react";

interface OverlayTopBarProps {
  screenshotCount: number;
  mode: "D" | "P";
  contentProtectionEnabled: boolean;
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
  onStartInterview,
  onOpenSettings,
  onDragHandleClick,
}: OverlayTopBarProps) => {
  const screenshotLabel =
    screenshotCount > 0
      ? `Screenshots captured: ${getScreenshotBadgeLabel(screenshotCount)}`
      : "No screenshots captured";

  const contentProtectionLabel = contentProtectionEnabled
    ? "Content protection is enabled"
    : "Content protection is disabled";

  return (
    <header className="flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={onStartInterview}
          aria-label="Start Interview"
        >
          Start Interview
        </button>

        {onDragHandleClick ? (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={onDragHandleClick}
            aria-label="Drag handle"
            data-tauri-drag-region
          >
            <GripVerticalIcon className="h-4 w-4" />
          </button>
        ) : (
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 text-muted-foreground"
            aria-hidden="true"
          >
            <GripVerticalIcon className="h-4 w-4" />
          </span>
        )}

        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 text-muted-foreground"
          role="status"
          aria-label={screenshotLabel}
        >
          <CameraIcon className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">{screenshotLabel}</span>
          {screenshotCount > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {getScreenshotBadgeLabel(screenshotCount)}
            </span>
          ) : null}
        </div>

        <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-xl border border-border/60 px-2 text-xs font-semibold text-muted-foreground">
          {mode}
        </span>

        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 ${
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
