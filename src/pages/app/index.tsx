import { Button, CustomCursor } from "@/components";
import {
  OverlayPanel,
  OverlayTopBar,
  ResponseView,
  SettingsView,
  TranscriptsView,
  type InterviewOverlayView,
} from "./components";
import { PermissionFlow } from "./components/speech/PermissionFlow";
import { ResultsSection } from "./components/speech/ResultsSection";
import { RollingTranscript } from "./components/speech/RollingTranscript";
import { Warning } from "./components/speech/Warning";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { EyeIcon, ShieldIcon, SparklesIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";
import { useEffect, useRef, useState } from "react";

const CONTENT_PROTECTION_KEY = "content_protected";
const CLICK_THROUGH_KEY = "click_through";
const CONVERSATION_VIEWS: Array<"response" | "transcripts"> = [
  "response",
  "transcripts",
];

const resolveCustomShortcutView = (
  actionId: string
): InterviewOverlayView | null => {
  const normalized = actionId.trim().toLowerCase();

  if (normalized.includes("response")) {
    return "response";
  }

  if (normalized.includes("transcript")) {
    return "transcripts";
  }

  if (normalized.includes("setting")) {
    return "settings";
  }

  return null;
};

const App = () => {
  const { systemAudio } = useApp();
  const { customizable, currentAIMode, setCurrentAIMode } = useAppContext();
  const platform = getPlatform();

  const [contentProtected, setContentProtected] = useState<boolean>(true);
  const [clickThrough, setClickThrough] = useState<boolean>(false);
  const [activeView, setActiveView] = useState<InterviewOverlayView>("response");
  const [lastConversationView, setLastConversationView] = useState<
    "response" | "transcripts"
  >("response");

  const wasCapturingRef = useRef<boolean>(Boolean(systemAudio?.capturing));

  const isSessionActive =
    systemAudio?.capturing ||
    systemAudio?.isProcessing ||
    systemAudio?.isAIProcessing ||
    false;

  useEffect(() => {
    if (!CONVERSATION_VIEWS.includes(activeView as "response" | "transcripts")) {
      return;
    }

    setLastConversationView(activeView as "response" | "transcripts");
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

        const nextView = resolveCustomShortcutView(actionId);
        if (nextView) {
          setActiveView(nextView);
        }
      }
    );

    const handleViewHotkeys = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        setActiveView("response");
      }

      if (event.key === "2") {
        event.preventDefault();
        setActiveView("transcripts");
      }
    };

    window.addEventListener("keydown", handleViewHotkeys);

    return () => {
      window.removeEventListener("keydown", handleViewHotkeys);
      unlistenAnswer.then((fn) => fn());
      unlistenCustom.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (activeView !== "settings") {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setActiveView(lastConversationView);
    };

    window.addEventListener("keydown", handleEscape, true);

    return () => {
      window.removeEventListener("keydown", handleEscape, true);
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
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(CLICK_THROUGH_KEY);
    if (saved !== null) {
      const savedValue = saved === "true";
      if (savedValue) {
        invoke<boolean>("toggle_click_through").catch(() => {});
      }
      setClickThrough(savedValue);
    } else {
      invoke<boolean>("get_click_through")
        .then((v) => setClickThrough(v))
        .catch(() => {});
    }

    const unlisten = listen<boolean>("click-through-changed", (event) => {
      const enabled = event.payload;
      setClickThrough(enabled);
      localStorage.setItem(CLICK_THROUGH_KEY, String(enabled));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    if (contentProtected) {
      root.classList.add("content-protected-active");
    } else {
      root.classList.remove("content-protected-active");
    }

    if (clickThrough) {
      root.classList.add("click-through-active");
    } else {
      root.classList.remove("click-through-active");
    }

    return () => {
      root.classList.remove("content-protected-active");
      root.classList.remove("click-through-active");
    };
  }, [clickThrough, contentProtected]);

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

  const toggleAIMode = () => {
    setCurrentAIMode(currentAIMode === "D" ? "P" : "D");
  };

  const toggleContentProtection = async () => {
    if (isSessionActive && contentProtected) {
      return;
    }

    try {
      const newState = await invoke<boolean>("toggle_content_protection");
      setContentProtected(newState);
      localStorage.setItem(CONTENT_PROTECTION_KEY, String(newState));
    } catch (error) {
      console.error("Failed to toggle content protection:", error);
    }
  };

  const handleStartInterview = async () => {
    if (!systemAudio) {
      return;
    }

    if (systemAudio.capturing) {
      await systemAudio.stopCapture("manual");
      return;
    }

    await systemAudio.startCapture("manual");
  };

  const openDashboard = async () => {
    try {
      await invoke("open_dashboard");
    } catch (error) {
      console.error("Failed to open dashboard:", error);
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
      <div className="w-screen h-screen flex overflow-hidden justify-center items-start">
        <OverlayPanel className="w-full max-w-[900px]">
          <OverlayTopBar
            screenshotCount={systemAudio?.manualScreenshots.length ?? 0}
            mode={currentAIMode}
            contentProtectionEnabled={contentProtected}
            onStartInterview={() => {
              void handleStartInterview();
            }}
            onOpenSettings={() => {
              setActiveView("settings");
            }}
          />

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
                <>
                  <ResultsSection
                    transcriptSegments={systemAudio?.transcriptSegments ?? []}
                    lastAIResponse={systemAudio?.lastAIResponse ?? ""}
                    isAIProcessing={Boolean(systemAudio?.isAIProcessing)}
                    textSize={14}
                  />

                  {!systemAudio?.lastAIResponse && systemAudio?.isAIProcessing ? (
                    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      Generating response...
                    </div>
                  ) : null}
                </>
              )}

              <Warning />
            </ResponseView>
          ) : null}

          {activeView === "transcripts" ? (
            <TranscriptsView>
              <RollingTranscript
                transcriptSegments={systemAudio?.transcriptSegments ?? []}
              />
              <ResultsSection
                transcriptSegments={systemAudio?.transcriptSegments ?? []}
                lastAIResponse={systemAudio?.lastAIResponse ?? ""}
                isAIProcessing={Boolean(systemAudio?.isAIProcessing)}
                textSize={14}
              />
            </TranscriptsView>
          ) : null}

          {activeView === "settings" ? (
            <SettingsView>
              <div className="space-y-3">
                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs font-medium text-foreground">Overlay controls</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Press <span className="font-semibold">Esc</span> to return to
                    the last conversation view.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant={currentAIMode === "P" ? "default" : "secondary"}
                    className="font-semibold"
                    title={
                      currentAIMode === "D"
                        ? "D mode active: fast responses. Click to switch to P mode."
                        : "P mode active: smarter slower responses. Click to switch to D mode."
                    }
                    onClick={toggleAIMode}
                  >
                    {currentAIMode}
                  </Button>

                  <Button
                    size="icon"
                    variant="ghost"
                    title={
                      isSessionActive && contentProtected
                        ? "Content protection is locked while an active session is running"
                        : contentProtected
                        ? "Content protection ON — window hidden from screen capture. Click to disable."
                        : "Content protection OFF — window visible to screen capture. Click to enable."
                    }
                    onClick={toggleContentProtection}
                    disabled={isSessionActive && contentProtected}
                    className={`shrink-0 ${contentProtected ? "text-red-400 hover:text-red-300" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {contentProtected ? (
                      <ShieldIcon className="h-4 w-4" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                  </Button>

                  <Button
                    size="icon"
                    className="cursor-pointer"
                    title="Open Dev Space"
                    onClick={openDashboard}
                  >
                    <SparklesIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </SettingsView>
          ) : null}

          {!systemAudio?.capturing && activeView !== "settings" ? (
            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
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
