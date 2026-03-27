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
import Settings from "@/pages/settings";
import { Loader2, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform, getResponseSettings, updateResponseLength } from "@/lib";
import { useCallback, useEffect, useRef, useState } from "react";

const CONTENT_PROTECTION_KEY = "content_protected";

type ResponseLengthMode = "short" | "medium" | "auto";

const VIEW_SHORTCUT_ACTIONS: Record<string, InterviewOverlayView> = {
  view_response: "response",
  view_transcripts: "transcripts",
  view_settings: "settings",
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

const normalizeResponseLengthMode = (value: string): ResponseLengthMode => {
  if (value === "short" || value === "medium" || value === "auto") {
    return value;
  }

  return "short";
};

const getVerbosityLabel = (
  mode: ResponseLengthMode
): "Auto" | "Short" | "Verbose" => {
  if (mode === "auto") {
    return "Auto";
  }

  return mode === "short" ? "Short" : "Verbose";
};

const App = () => {
  const { systemAudio } = useApp();
  const {
    customizable,
    currentAIMode,
    setCurrentAIMode,
    toggleCurrentAIMode,
  } = useAppContext();
  const platform = getPlatform();

  const [contentProtected, setContentProtected] = useState<boolean>(true);
  const [activeView, setActiveView] = useState<InterviewOverlayView>("collapsed");
  const [isQuickPromptOpen, setIsQuickPromptOpen] = useState<boolean>(false);
  const [quickPromptText, setQuickPromptText] = useState<string>("");
  const [lastConversationView, setLastConversationView] = useState<
    "response" | "transcripts"
  >("transcripts");
  const [responseLengthMode, setResponseLengthMode] =
    useState<ResponseLengthMode>(() => {
      return normalizeResponseLengthMode(getResponseSettings().responseLength);
    });

  useClickableRects([activeView]);

  const wasCapturingRef = useRef<boolean>(Boolean(systemAudio?.capturing));
  const quickPromptInputRef = useRef<HTMLInputElement | null>(null);
  const quickPromptSendInFlightRef = useRef<boolean>(false);

  const isSessionActive =
    systemAudio?.capturing ||
    systemAudio?.isProcessing ||
    systemAudio?.isAIProcessing ||
    false;
  const isRecording = Boolean(systemAudio?.capturing);
  const hasStandaloneResponse =
    Boolean(systemAudio?.isAIProcessing) ||
    Boolean(systemAudio?.lastAIResponse) ||
    Boolean(systemAudio?.error);
  const canShowResponseView = isRecording || hasStandaloneResponse;

  const responseText = systemAudio?.lastAIResponse ?? "";
  const responseHasCode = /```[\s\S]*?```|`[^`\n]+`/.test(responseText);

  const handleQuickPromptSend = useCallback(async () => {
    if (!systemAudio || quickPromptSendInFlightRef.current) {
      return;
    }

    const typedText = quickPromptText.trim();
    if (!isRecording && !typedText) {
      return;
    }

    quickPromptSendInFlightRef.current = true;
    try {
      setActiveView("response");

      const sent = await systemAudio.onAnswerTrigger(typedText || undefined);
      if (!sent) {
        return;
      }

      setQuickPromptText("");
      setIsQuickPromptOpen(false);
    } finally {
      quickPromptSendInFlightRef.current = false;
    }
  }, [isRecording, quickPromptText, systemAudio]);

  const handleClearActivePanel = useCallback(() => {
    if (!systemAudio) {
      return;
    }

    if (activeView === "response") {
      systemAudio.clearPanelMemory("response");
      return;
    }

    if (activeView === "transcripts") {
      systemAudio.clearPanelMemory("transcripts");
    }
  }, [activeView, systemAudio]);

  const handleToggleVerbosityMode = useCallback(() => {
    setResponseLengthMode((current) => {
      const normalized = normalizeResponseLengthMode(current);
      const nextMode: ResponseLengthMode =
        normalized === "auto"
          ? "short"
          : normalized === "short"
            ? "medium"
            : "short";

      updateResponseLength(nextMode);
      return nextMode;
    });
  }, []);

  useEffect(() => {
    const syncResponseLengthMode = () => {
      const stored = getResponseSettings().responseLength;
      const normalized = normalizeResponseLengthMode(stored);
      if (normalized !== stored) {
        updateResponseLength(normalized);
      }
      setResponseLengthMode(normalized);
    };

    syncResponseLengthMode();
    window.addEventListener("responseSettingsChanged", syncResponseLengthMode);
    window.addEventListener("storage", syncResponseLengthMode);

    return () => {
      window.removeEventListener("responseSettingsChanged", syncResponseLengthMode);
      window.removeEventListener("storage", syncResponseLengthMode);
    };
  }, []);

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
      if (isQuickPromptOpen) {
        void handleQuickPromptSend();
        return;
      }

      if (!isRecording) {
        return;
      }
      setActiveView("response");
    });

    const unlistenCustom = listen<{ action?: string }>(
      "custom-shortcut-triggered",
      (event) => {
        const actionId = event.payload?.action;
        if (!actionId) {
          return;
        }

        // Handle model toggle
        if (actionId.trim().toLowerCase() === "toggle_model_mode") {
          handleToggleMode();
          return;
        }

        if (actionId.trim().toLowerCase() === "toggle_verbosity_mode") {
          handleToggleVerbosityMode();
          return;
        }

        if (actionId.trim().toLowerCase() === "view_settings") {
          void openSettingsPanel();
          return;
        }

        if (actionId.trim().toLowerCase() === "clear_active_panel") {
          handleClearActivePanel();
          return;
        }

        const nextView = resolveCustomShortcutView(actionId);
        if (!isRecording && (nextView === "response" || nextView === "transcripts")) {
          return;
        }

        if (nextView) {
          setActiveView(nextView);
        }
      }
    );

    return () => {
      unlistenAnswer
        .then((fn) => fn())
        .catch(() => {});
      unlistenCustom
        .then((fn) => fn())
        .catch(() => {});
    };
  }, [
    handleClearActivePanel,
    handleQuickPromptSend,
    handleToggleVerbosityMode,
    isQuickPromptOpen,
    isRecording,
  ]);

  useEffect(() => {
    if (
      !isRecording &&
      !hasStandaloneResponse &&
      (activeView === "response" || activeView === "transcripts")
    ) {
      setActiveView("collapsed");
    }
  }, [activeView, hasStandaloneResponse, isRecording]);

  useEffect(() => {
    const unlistenFocus = listen("focus-text-input", () => {
      setIsQuickPromptOpen(true);
      setTimeout(() => {
        quickPromptInputRef.current?.focus();
      }, 40);
    });

    return () => {
      unlistenFocus
        .then((fn) => fn())
        .catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!isQuickPromptOpen) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      quickPromptInputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(animationFrame);
    };
  }, [isQuickPromptOpen]);

  useEffect(() => {
    const globalWindow = window as Window & {
      __ghostframeQuickPromptOpen?: boolean;
    };

    globalWindow.__ghostframeQuickPromptOpen = isQuickPromptOpen;

    return () => {
      globalWindow.__ghostframeQuickPromptOpen = false;
    };
  }, [isQuickPromptOpen]);

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

    if (activeView === "settings") {
      root.classList.remove("click-through-active");
      // Disable click-through at the Rust level when in settings
      invoke("set_click_through", { enabled: false }).catch((error) => {
        console.error("Failed to disable click-through for settings:", error);
      });
    } else {
      root.classList.add("click-through-active");
      // Re-enable click-through at the Rust level when leaving settings
      invoke("set_click_through", { enabled: true }).catch((error) => {
        console.error("Failed to enable click-through:", error);
      });
    }

    return () => {
      root.classList.remove("content-protected-active");
      root.classList.remove("click-through-active");
    };
  }, [activeView, contentProtected]);

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

  const handleToggleMode = () => {
    setCurrentAIMode(currentAIMode === "P" ? "D" : "P");
  };

  const handleQuickPromptKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const hasModifier = event.ctrlKey || event.metaKey;

    if (hasModifier && event.key === "Enter") {
      event.preventDefault();
      void handleQuickPromptSend();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsQuickPromptOpen(false);
    }
  };

  useEffect(() => {
    const unlistenToggleModel = listen("toggle-model-mode", () => {
      toggleCurrentAIMode();
    });

    return () => {
      unlistenToggleModel
        .then((fn) => fn())
        .catch(() => {});
    };
  }, [toggleCurrentAIMode]);

    const openSettingsPanel = async () => {
      try {
        if (activeView === "settings") {
          setActiveView(lastConversationView);
        } else {
          setActiveView("settings");
        }
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
      }}
      >
        <div className="w-screen h-screen flex overflow-hidden justify-center items-start px-4 pt-4 pointer-events-none">
        <OverlayPanel
          viewMode={activeView}
          onSetViewMode={setActiveView}
          className="overlay-shell-width"
          topBar={
            <>
              {isQuickPromptOpen ? (
                <div className="pointer-events-none mb-2 flex justify-center">
                  <div className="w-full max-w-[720px] pointer-events-auto">
                    <input
                      ref={quickPromptInputRef}
                      value={quickPromptText}
                      onChange={(event) => setQuickPromptText(event.target.value)}
                      onKeyDown={handleQuickPromptKeyDown}
                      placeholder="Type context/instruction..."
                      className="overlay-panel-glass w-full rounded-2xl border border-white/[0.14] shadow-xl shadow-black/20 px-3.5 py-3 text-[12px] text-white/95 placeholder:text-white/45 outline-none ring-0 focus:outline-none focus:ring-0 focus:border-white/[0.2]"
                      aria-label="Quick prompt input"
                    />
                  </div>
                </div>
              ) : null}

              <OverlayTopBar
                screenshotCount={systemAudio?.processedManualScreenshotsCount ?? 0}
                mode={currentAIMode}
                verbosityLabel={getVerbosityLabel(responseLengthMode)}
                isCapturing={Boolean(systemAudio?.capturing)}
                onStartInterview={() => {
                    void handleStartInterview();
                  }}
                onOpenSettings={() => { void openSettingsPanel(); }}
                onToggleMode={handleToggleMode}
                onToggleVerbosity={handleToggleVerbosityMode}
              />
            </>
          }
        >

          {activeView === "response" && canShowResponseView ? (
            <ResponseView>
              {systemAudio?.error ? (
                <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{systemAudio.error}</span>
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
                  </div>
                </div>
              )}

            </ResponseView>
          ) : null}

          {activeView === "transcripts" && isRecording ? (
            <TranscriptsView transcriptSegments={systemAudio?.transcriptSegments ?? []} />
          ) : null}

          {activeView === "settings" ? (
            <div className="flex-1 w-full h-full flex overflow-hidden">
              <Settings onClose={() => setActiveView(lastConversationView)} />
            </div>
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
