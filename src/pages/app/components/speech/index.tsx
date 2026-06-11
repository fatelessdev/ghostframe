import { useEffect, useState } from "react";
import {
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  ScrollArea,
} from "@/components";
import {
  HeadphonesIcon,
  AlertCircleIcon,
  LoaderIcon,
  AudioLinesIcon,
  CameraIcon,
  PlusIcon,
  XIcon,
  SendIcon,
} from "lucide-react";
import { PermissionFlow } from "./PermissionFlow";
import { ResultsSection } from "./ResultsSection";
import { Warning } from "./Warning";
import { RollingTranscript } from "./RollingTranscript";
import { useSystemAudioType } from "@/hooks";
import { useApp } from "@/contexts";
import { cn } from "@/lib/utils";
import {
  DEFAULT_RESPONSE_SETTINGS,
  getResponseSettings,
} from "@/lib/storage/response-settings.storage";

const MIN_PANEL_WIDTH = 480;
const MIN_PANEL_HEIGHT = 320;

export const SystemAudio = (props: useSystemAudioType) => {
  const {
    capturing,
    isProcessing,
    isAIProcessing,
    lastAIResponse,
    error,
    setupRequired,
    startCapture,
    stopCapture,
    isPopoverOpen,
    setIsPopoverOpen,
    startNewConversation,
    quickActions,
    handleQuickActionClick,
    transcriptSegments,
    manualScreenshots,
    processedManualScreenshotsCount,
    pendingManualScreenshotsCount,
    removeManualScreenshot,
    isCapturingScreenshot,
    handleCaptureScreenshot,
    onAnswerTrigger,
    scrollAreaRef,
  } = props;

  const { supportsImages } = useApp();
  const [responseSettings, setResponseSettings] = useState(() =>
    getResponseSettings()
  );

  useEffect(() => {
    const syncResponseSettings = () => {
      setResponseSettings(getResponseSettings());
    };

    const handleResponseSettingsChanged = (event: Event) => {
      const customEvent = event as CustomEvent<typeof DEFAULT_RESPONSE_SETTINGS>;
      if (customEvent.detail) {
        setResponseSettings(customEvent.detail);
        return;
      }

      syncResponseSettings();
    };

    window.addEventListener("storage", syncResponseSettings);
    window.addEventListener(
      "responseSettingsChanged",
      handleResponseSettingsChanged as EventListener
    );

    return () => {
      window.removeEventListener("storage", syncResponseSettings);
      window.removeEventListener(
        "responseSettingsChanged",
        handleResponseSettingsChanged as EventListener
      );
    };
  }, []);

  const handleToggleCapture = async () => {
    if (capturing) {
      await stopCapture("manual");
    } else {
      await startCapture("manual");
    }
  };

  const getButtonIcon = () => {
    if (setupRequired) {
      return <AlertCircleIcon className="text-orange-500" />;
    }
    if (error && !setupRequired) {
      return <AlertCircleIcon className="text-red-500" />;
    }
    if (isProcessing || isAIProcessing) {
      return <LoaderIcon className="animate-spin" />;
    }
    if (capturing) {
      return <AudioLinesIcon className="text-emerald-500" />;
    }
    return <HeadphonesIcon />;
  };

  const getButtonTitle = () => {
    if (setupRequired) {
      return "Setup required - Click for instructions";
    }
    if (error && !setupRequired) {
      return `Error: ${error}`;
    }
    if (isProcessing || isAIProcessing) {
      return "Processing interview context...";
    }
    if (capturing) {
      return "Stop system audio capture";
    }
    return "Start system audio capture";
  };

  const hasResponse = !!lastAIResponse || isAIProcessing;

  return (
    <Popover
      open={isPopoverOpen}
      onOpenChange={(open) => {
        if (capturing && !open) {
          return;
        }
        setIsPopoverOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="icon"
          title={getButtonTitle()}
          onClick={handleToggleCapture}
          className={cn(
            capturing && "bg-emerald-50 hover:bg-emerald-100",
            error && "bg-red-100 hover:bg-red-200"
          )}
        >
          {getButtonIcon()}
        </Button>
      </PopoverTrigger>

      {(capturing || setupRequired || error) && (
        <PopoverContent
          align="center"
          side="bottom"
          className="glass-card select-none p-0 border shadow-lg overflow-hidden border-input/50 min-w-[480px] min-h-[320px] max-h-[calc(100vh-4rem)]"
          sideOffset={8}
          style={{
            width: `${Math.max(MIN_PANEL_WIDTH, responseSettings.panelWidth)}px`,
            height: `${Math.max(MIN_PANEL_HEIGHT, responseSettings.panelHeight)}px`,
            resize: "none",
          }}
        >
          <div className="flex flex-col h-full overflow-hidden bg-background">
            <div className="flex-shrink-0 p-3 border-b border-border/50">
              <div className="flex items-center justify-between gap-2">
                {setupRequired ? (
                  <h2 className="font-semibold text-sm">Setup Required</h2>
                ) : (
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-500/10 px-2 py-0.5 text-emerald-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Dual STT Live
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {!setupRequired && (
                    <Button
                      size="sm"
                      onClick={() => void onAnswerTrigger()}
                      disabled={isProcessing || isAIProcessing}
                      className="h-7 text-[10px] gap-1 px-2"
                      title="Send current transcript and screenshots"
                    >
                      <SendIcon className="w-3 h-3" />
                      Send
                    </Button>
                  )}

                  {!setupRequired && supportsImages && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCaptureScreenshot()}
                      disabled={isCapturingScreenshot}
                      className="h-7 text-[10px] gap-1 px-2"
                      title="Attach manual screenshot"
                    >
                      {isCapturingScreenshot ? (
                        <LoaderIcon className="w-3 h-3 animate-spin" />
                      ) : (
                        <CameraIcon className="w-3 h-3" />
                      )}
                      Screenshot
                    </Button>
                  )}

                  {!setupRequired && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={startNewConversation}
                      className="h-7 text-[10px] gap-1 px-2"
                      title="Start a new conversation"
                    >
                      <PlusIcon className="w-3 h-3" />
                      New
                    </Button>
                  )}

                  {!capturing && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      title="Close"
                      aria-label="Close"
                      onClick={() => {
                        setIsPopoverOpen(false);
                      }}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <ScrollArea className="flex-1 min-h-0" ref={scrollAreaRef}>
              <div className="p-2 space-y-2">
                {error && !setupRequired && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200">
                    <AlertCircleIcon className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-medium text-red-800">Error</p>
                      <p className="text-[10px] text-red-700">{error}</p>
                    </div>
                  </div>
                )}

                {setupRequired ? (
                  <PermissionFlow
                    onPermissionGranted={() => {
                      void startCapture("setup");
                    }}
                    onPermissionDenied={() => {
                      // no-op
                    }}
                  />
                ) : (
                  <>
                    <RollingTranscript transcriptSegments={transcriptSegments} />

                    {manualScreenshots.length > 0 ? (
                      <div className="rounded-md border border-border/60 bg-muted/10 p-2 space-y-2">
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Manual screenshots ({processedManualScreenshotsCount})
                          {pendingManualScreenshotsCount > 0
                            ? ` + ${pendingManualScreenshotsCount} processing`
                            : ""}
                        </p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {manualScreenshots.map((shot) => (
                            <div
                              key={shot.id}
                              className="relative shrink-0 rounded border border-border/60"
                            >
                              {shot.image ? (
                                <img
                                  src={`data:${shot.image.mimeType};base64,${shot.image.base64}`}
                                  alt="Manual screenshot"
                                  className="h-16 w-28 object-cover rounded"
                                />
                              ) : (
                                <div className="h-16 w-28 rounded bg-muted/30 animate-pulse" />
                              )}
                              <button
                                type="button"
                                onClick={() => removeManualScreenshot(shot.id)}
                                className="absolute -top-1 -right-1 rounded-full bg-background border border-border h-5 w-5 text-[10px]"
                                title="Remove screenshot"
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <ResultsSection
                      transcriptSegments={transcriptSegments}
                      lastAIResponse={lastAIResponse}
                      isAIProcessing={isAIProcessing}
                      textSize={responseSettings.textSize}
                    />

                    <Warning />
                  </>
                )}
              </div>
            </ScrollArea>

            {!setupRequired && hasResponse && quickActions.length > 0 && (
              <div className="flex-shrink-0 border-t border-border/50 p-2">
                <div className="rounded-lg border border-border/50 bg-muted/20 p-2 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Quick actions
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {quickActions.map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => void handleQuickActionClick(action)}
                        className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      )}
    </Popover>
  );
};
