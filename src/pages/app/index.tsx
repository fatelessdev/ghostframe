import { Card, DragButton, CustomCursor, Button } from "@/components";
import {
  SystemAudio,
  Completion,
  AudioVisualizer,
  StatusIndicator,
} from "./components";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import {
  SparklesIcon,
  ShieldIcon,
  EyeIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";
import { useState, useEffect } from "react";

const CONTENT_PROTECTION_KEY = "content_protected";
const CLICK_THROUGH_KEY = "click_through";

const App = () => {
  const { systemAudio } = useApp();
  const { customizable, currentAIMode, setCurrentAIMode } = useAppContext();
  const platform = getPlatform();

  const [contentProtected, setContentProtected] = useState<boolean>(true);
  const [clickThrough, setClickThrough] = useState<boolean>(false);

  const isSessionActive =
    systemAudio?.capturing ||
    systemAudio?.isProcessing ||
    systemAudio?.isAIProcessing ||
    false;

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
        <Card className="glass-card w-full flex flex-row items-center gap-2 p-2">
          <SystemAudio {...systemAudio} />
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

          {systemAudio?.capturing ? (
            <div className="flex flex-row items-center gap-2 justify-between w-full">
              <div className="flex flex-1 items-center gap-2">
                <AudioVisualizer isRecording={systemAudio?.capturing} />
              </div>
              <div className="flex !w-fit items-center gap-2">
                <StatusIndicator
                  setupRequired={systemAudio.setupRequired}
                  error={systemAudio.error}
                  isProcessing={systemAudio.isProcessing}
                  isAIProcessing={systemAudio.isAIProcessing}
                  capturing={systemAudio.capturing}
                />
              </div>
            </div>
          ) : null}

          <div
            className={`${
              systemAudio?.capturing
                ? "hidden w-full fade-out transition-all duration-300"
                : "w-full flex flex-row gap-2 items-center"
            }`}
          >
            <Completion />
            <Button
              size={"icon"}
              className="cursor-pointer"
              title="Open Dev Space"
              onClick={openDashboard}
            >
              <SparklesIcon className="h-4 w-4" />
            </Button>
          </div>

          <DragButton />
        </Card>
        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
