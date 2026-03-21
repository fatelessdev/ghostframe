import { CopyButton, CustomCursor, Markdown } from "@/components";
import {
  OverlayPanel,
  OverlayTopBar,
  ResponseView,
  TranscriptsView,
  type InterviewOverlayView,
} from "./components";
import { PermissionFlow } from "./components/speech/PermissionFlow";
import { useApp, useClickableRects } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";
import { useEffect, useRef, useState } from "react";

const CONTENT_PROTECTION_KEY = "content_protected";

const VIEW_SHORTCUT_ACTIONS: Record<string, InterviewOverlayView> = {
  view_response: "response",
  view_transcripts: "transcripts",
};

const isEditableElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    target.isContentEditable
  );
};

const resolveCustomShortcutView = (
  actionId: string
): InterviewOverlayView | null => {
  return VIEW_SHORTCUT_ACTIONS[actionId.trim().toLowerCase()] ?? null;
};

const App = () => {
  const { systemAudio } = useApp();
  const { customizable, currentAIMode } = useAppContext();
  const platform = getPlatform();

  const [contentProtected, setContentProtected] = useState<boolean>(true);
  const [activeView, setActiveView] = useState<InterviewOverlayView>("collapsed");
  const [shortcutScreenshotCount, setShortcutScreenshotCount] =
    useState<number>(0);
  const [attachmentScreenshotCount, setAttachmentScreenshotCount] =
    useState<number>(0);
  const [lastConversationView, setLastConversationView] = useState<
    "response" | "transcripts"
  >("transcripts");

  useClickableRects([activeView]);

  const wasCapturingRef = useRef<boolean>(Boolean(systemAudio?.capturing));

  const isSessionActive =
    systemAudio?.capturing ||
    systemAudio?.isProcessing ||
    systemAudio?.isAIProcessing ||
    false;

  const responseText = systemAudio?.lastAIResponse ?? "";
  const responseHasCode = /```[\s\S]*?```|`[^`\n]+`/.test(responseText);

  useEffect(() => {
    if (activeView === "response" || activeView === "transcripts") {
      setLastConversationView(activeView);
    }
  }, [activeView]);

  useEffect(() => {
    const nowCapturing = Boolean(systemAudio?.capturing);

    if (nowCapturing && !wasCapturingRef.current) {
      setActiveView("transcripts");
    }

    wasCapturingRef.current = nowCapturing;
  }, [systemAudio?.capturing]);

  useEffect(() => {
    const unlistenAnswer = listen("trigger-answer", () => {
      setActiveView("response");
    });

    const unlistenCustom = listen<{ action?: string }>(
      "custom-shortcut-triggered",
      (event) => {
        const actionId = event.payload?.action;
        if (!actionId) {
          return;
        }

        if (actionId.trim().toLowerCase() === "view_settings") {
          void openSettingsPanel();
          return;
        }

        const nextView = resolveCustomShortcutView(actionId);
        if (nextView) {
          setActiveView(nextView);
        }
      }
    );

    const unlistenScreenshot = listen("trigger-screenshot", () => {
      setShortcutScreenshotCount((previousCount) => previousCount + 1);
    });

    const handleAttachmentCountChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ count?: number }>;
      const nextCount = customEvent.detail?.count;
      if (typeof nextCount === "number" && Number.isFinite(nextCount)) {
        setAttachmentScreenshotCount(Math.max(0, Math.floor(nextCount)));
      }
    };

    window.addEventListener(
      "completion-attachment-count-changed",
      handleAttachmentCountChanged as EventListener
    );

    return () => {
      unlistenAnswer
        .then((fn) => fn())
        .catch(() => {});
      unlistenCustom
        .then((fn) => fn())
        .catch(() => {});
      unlistenScreenshot
        .then((fn) => fn())
        .catch(() => {});
      window.removeEventListener(
        "completion-attachment-count-changed",
        handleAttachmentCountChanged as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (activeView === "collapsed") {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key !== "Escape") {
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }

      if (isEditableElement(event.target)) {
        return;
      }

      event.preventDefault();
      setActiveView(lastConversationView);
    };

    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [activeView, lastConversationView]);

  useEffect(() => {
    // Read saved preference; if none saved, read current Rust state
    const saved = localStorage.getItem(CONTENT_PROTECTION_KEY);
    if (saved !== null) {
      const savedValue = saved === "true";
      // Default Rust state is true; only need to toggle if saved preference is false
      if (!savedValue) {
        invoke<boolean>("toggle_content_protection").catch(() => {});
      }
      setContentProtected(savedValue);
    } else {
      invoke<boolean>("get_content_protection")
        .then((v) => setContentProtected(v))
        .catch(() => {});
    }

    // Keep UI in sync when another part of the app (e.g. dashboard) toggles this
    const unlisten = listen<boolean>("content-protection-changed", (event) => {
      setContentProtected(event.payload);
      localStorage.setItem(CONTENT_PROTECTION_KEY, String(event.payload));
    });

    return () => {
      unlisten
        .then((fn) => fn())
        .catch(() => {});
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (contentProtected) {
      root.classList.add("content-protected-active");
    } else {
      root.classList.remove("content-protected-active");
    }

    root.classList.add("click-through-active");

    return () => {
      root.classList.remove("content-protected-active");
      root.classList.remove("click-through-active");
    };
  }, [contentProtected]);

  useEffect(() => {
    if (isSessionActive && !contentProtected) {
      invoke<boolean>("toggle_content_protection")
        .then((enabled) => {
          setContentProtected(enabled);
          localStorage.setItem(CONTENT_PROTECTION_KEY, String(enabled));
        })
        .catch((error) => {
          console.error("Failed to auto-enable content protection:", error);
        });
    }
  }, [contentProtected, isSessionActive]);

  const handleStartInterview = async () => {
    if (!systemAudio) {
      return;
    }

    if (systemAudio.capturing) {
      await systemAudio.stopCapture("manual");
      setActiveView("collapsed");
      return;
    }

    setActiveView("transcripts");
    await systemAudio.startCapture("manual");
  };

    const openSettingsPanel = async () => {
      try {
        await invoke("open_dashboard_settings");
      } catch (error) {
        console.error("Failed to open dashboard settings:", error);
      }
    };

  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout isCompact />;
      }}
      resetKeys={["app-error"]}
      onReset={() => {
        console.log("Reset");
      }}
      >
        <div className="w-screen h-screen flex overflow-hidden justify-center items-start px-4 pt-4 pointer-events-none">
        <OverlayPanel
          viewMode={activeView}
          className="overlay-shell-width"
          topBar={
            <OverlayTopBar
              screenshotCount={Math.max(
                systemAudio?.manualScreenshots.length ?? 0,
                attachmentScreenshotCount,
                shortcutScreenshotCount
              )}
              mode={currentAIMode}
              contentProtectionEnabled={contentProtected}
              isCapturing={Boolean(systemAudio?.capturing)}
              onStartInterview={() => {
                void handleStartInterview();
              }}
              onOpenSettings={() => {
                void openSettingsPanel();
              }}
            />
          }
        >

          {activeView === "response" ? (
            <ResponseView>
              {systemAudio?.error ? (
                <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {systemAudio.error}
                </div>
              ) : null}

              {systemAudio?.setupRequired ? (
                <PermissionFlow
                  onPermissionGranted={() => {
                    void systemAudio.startCapture("setup");
                  }}
                  onPermissionDenied={() => {
                    // no-op
                  }}
                />
              ) : (
                <div className="group relative h-full w-full">
                  {responseHasCode && responseText ? (
                    <div className="pointer-events-auto absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                      <CopyButton content={responseText} />
                    </div>
                  ) : null}

                  {Boolean(systemAudio?.isAIProcessing) && !responseText ? (
                    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      <span>Generating response...</span>
                    </div>
                  ) : null}

                  <div className="response-text-root prose prose-sm max-w-none select-text dark:prose-invert">
                    <Markdown>{responseText}</Markdown>
                    {Boolean(systemAudio?.isAIProcessing) && responseText ? (
                      <span className="ml-1 inline-block h-4 w-2 animate-pulse bg-primary align-middle" />
                    ) : null}
                  </div>
                </div>
              )}

            </ResponseView>
          ) : null}

          {activeView === "transcripts" ? (
            <TranscriptsView transcriptSegments={systemAudio?.transcriptSegments ?? []} />
          ) : null}
        </OverlayPanel>
        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
