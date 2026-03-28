import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef } from "react";
import { getShortcutsConfig } from "@/lib";

// Global singleton to prevent multiple event listeners in StrictMode
let globalEventListeners: {
  focus?: UnlistenFn;
  audio?: UnlistenFn;
  screenshot?: UnlistenFn;
  systemAudio?: UnlistenFn;
  answerTrigger?: UnlistenFn;
  responseScrollUp?: UnlistenFn;
  responseScrollDown?: UnlistenFn;
  customShortcut?: UnlistenFn;
  registrationError?: UnlistenFn;
} = {};

// Global debounce for screenshot events to prevent duplicates
let lastScreenshotEventTime = 0;

// Global callback refs
let globalInputRef: HTMLInputElement | null = null;
let globalAudioCallback: (() => void) | null = null;
let globalScreenshotCallback: (() => void | Promise<void>) | null = null;
let globalSystemAudioCallback: (() => void) | null = null;
let globalAnswerTriggerCallback: (() => void | Promise<void>) | null = null;
let globalResponseScrollUpCallbacks: Set<() => void> = new Set();
let globalResponseScrollDownCallbacks: Set<() => void> = new Set();
let globalCustomShortcutCallbacks: Map<string, () => void> = new Map();

const ROUTE_HANDLED_CUSTOM_ACTIONS = new Set([
  "view_response",
  "view_transcripts",
  "view_settings",
  "clear_active_panel",
  "toggle_verbosity_mode",
]);

// Global hook consumer count for singleton listener lifecycle
let globalShortcutsConsumerCount = 0;
let globalListenersReady = false;
let globalListenersSetupInProgress = false;
let globalListenersSetupGeneration = 0;

const clearGlobalResponseScrollCallbacks = (): void => {
  globalResponseScrollUpCallbacks.clear();
  globalResponseScrollDownCallbacks.clear();
};

const fallbackScrollActiveView = (delta: number): void => {
  const candidates: Array<HTMLElement | null> = [
    document.querySelector<HTMLElement>("[aria-label='AI response']"),
    document.querySelector<HTMLElement>("[aria-label='Live transcript']"),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (candidate.scrollHeight <= candidate.clientHeight + 1) {
      continue;
    }

    candidate.scrollBy({
      top: delta,
      behavior: "auto",
    });
    return;
  }
};

const isCurrentSetup = (setupGeneration: number): boolean => {
  return (
    setupGeneration === globalListenersSetupGeneration &&
    globalShortcutsConsumerCount > 0
  );
};

const cleanupGlobalEventListeners = (): void => {
  const listenerCleanupMap: Array<{
    key: keyof typeof globalEventListeners;
    label: string;
  }> = [
    { key: "focus", label: "focus" },
    { key: "audio", label: "audio" },
    { key: "screenshot", label: "screenshot" },
    { key: "systemAudio", label: "system audio" },
    { key: "answerTrigger", label: "answer trigger" },
    { key: "responseScrollUp", label: "response scroll up" },
    { key: "responseScrollDown", label: "response scroll down" },
    { key: "customShortcut", label: "custom shortcut" },
    {
      key: "registrationError",
      label: "shortcut registration error",
    },
  ];

  listenerCleanupMap.forEach(({ key, label }) => {
    const unlisten = globalEventListeners[key];
    if (!unlisten) {
      return;
    }

    try {
      unlisten();
    } catch (error) {
      console.warn(`Error cleaning up ${label} listener:`, error);
    }

    delete globalEventListeners[key];
  });
};

export const useGlobalShortcuts = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioCallbackRef = useRef<(() => void) | null>(null);
  const screenshotCallbackRef = useRef<(() => void) | null>(null);
  const systemAudioCallbackRef = useRef<(() => void) | null>(null);
  const answerTriggerCallbackRef = useRef<(() => void) | null>(null);
  const responseScrollUpCallbackRef = useRef<(() => void) | null>(null);
  const responseScrollDownCallbackRef = useRef<(() => void) | null>(null);
  const customShortcutCallbacksRef = useRef<Map<string, () => void>>(new Map());

  const checkShortcutsRegistered = useCallback(async (): Promise<boolean> => {
    try {
      const registered = await invoke<boolean>("check_shortcuts_registered");
      return registered;
    } catch (error) {
      console.error("Failed to check shortcuts:", error);
      return false;
    }
  }, []);

  const getShortcuts = useCallback(async (): Promise<Record<
    string,
    string
  > | null> => {
    try {
      const shortcuts = await invoke<Record<string, string>>(
        "get_registered_shortcuts"
      );
      return shortcuts;
    } catch (error) {
      console.error("Failed to get shortcuts:", error);
      return null;
    }
  }, []);

  const updateShortcuts = useCallback(async (): Promise<boolean> => {
    try {
      const config = getShortcutsConfig();
      await invoke("update_shortcuts", { config });
      return true;
    } catch (error) {
      console.error("Failed to update shortcuts:", error);
      return false;
    }
  }, []);

  // Register input element for auto-focus
  const registerInputRef = useCallback((input: HTMLInputElement | null) => {
    inputRef.current = input;
    globalInputRef = input;
  }, []);

  // Register audio callback
  const registerAudioCallback = useCallback((callback: () => void) => {
    audioCallbackRef.current = callback;
    globalAudioCallback = callback;
  }, []);

  // Register screenshot callback
  const registerScreenshotCallback = useCallback(
    (callback: () => void | Promise<void>) => {
      screenshotCallbackRef.current = callback;
      globalScreenshotCallback = callback;
    },
    []
  );

  const unregisterScreenshotCallback = useCallback(() => {
    const ownedCallback = screenshotCallbackRef.current;
    screenshotCallbackRef.current = null;

    if (ownedCallback && globalScreenshotCallback === ownedCallback) {
      globalScreenshotCallback = null;
    }
  }, []);

  // Register system audio callback
  const registerSystemAudioCallback = useCallback((callback: () => void) => {
    systemAudioCallbackRef.current = callback;
    globalSystemAudioCallback = callback;
  }, []);

  const registerAnswerTriggerCallback = useCallback(
    (callback: () => void | Promise<void>) => {
      answerTriggerCallbackRef.current = callback;
      globalAnswerTriggerCallback = callback;
    },
    []
  );

  const registerResponseScrollUpCallback = useCallback((callback: () => void) => {
    const previousCallback = responseScrollUpCallbackRef.current;
    if (previousCallback) {
      globalResponseScrollUpCallbacks.delete(previousCallback);
    }

    responseScrollUpCallbackRef.current = callback;
    globalResponseScrollUpCallbacks.add(callback);
  }, []);

  const registerResponseScrollDownCallback = useCallback((callback: () => void) => {
    const previousCallback = responseScrollDownCallbackRef.current;
    if (previousCallback) {
      globalResponseScrollDownCallbacks.delete(previousCallback);
    }

    responseScrollDownCallbackRef.current = callback;
    globalResponseScrollDownCallbacks.add(callback);
  }, []);

  const unregisterResponseScrollUpCallback = useCallback(() => {
    const ownedCallback = responseScrollUpCallbackRef.current;
    responseScrollUpCallbackRef.current = null;

    if (ownedCallback) {
      globalResponseScrollUpCallbacks.delete(ownedCallback);
    }
  }, []);

  const unregisterResponseScrollDownCallback = useCallback(() => {
    const ownedCallback = responseScrollDownCallbackRef.current;
    responseScrollDownCallbackRef.current = null;

    if (ownedCallback) {
      globalResponseScrollDownCallbacks.delete(ownedCallback);
    }
  }, []);

  // Register custom shortcut callback
  const registerCustomShortcutCallback = useCallback(
    (actionId: string, callback: () => void) => {
      customShortcutCallbacksRef.current.set(actionId, callback);
      globalCustomShortcutCallbacks.set(actionId, callback);
    },
    []
  );

  // Unregister custom shortcut callback
  const unregisterCustomShortcutCallback = useCallback((actionId: string) => {
    customShortcutCallbacksRef.current.delete(actionId);
    globalCustomShortcutCallbacks.delete(actionId);
  }, []);

  // Setup event listeners using global singleton
  useEffect(() => {
    globalShortcutsConsumerCount += 1;
    const shouldSetupListeners =
      !globalListenersReady &&
      !globalListenersSetupInProgress;

    if (!shouldSetupListeners) {
      return () => {
        globalShortcutsConsumerCount = Math.max(0, globalShortcutsConsumerCount - 1);
        if (globalShortcutsConsumerCount === 0) {
          globalListenersSetupGeneration += 1;
          globalListenersSetupInProgress = false;
          globalListenersReady = false;
          cleanupGlobalEventListeners();
          clearGlobalResponseScrollCallbacks();
        }
      };
    }

    globalListenersSetupInProgress = true;
    const setupGeneration = ++globalListenersSetupGeneration;
    let isActive = true;

    const setupEventListeners = async () => {
      try {
        // Clean up any existing global listeners first
        cleanupGlobalEventListeners();

        // Listen for focus text input event
        const unlistenFocus = await listen("focus-text-input", () => {
          setTimeout(() => {
            if (globalInputRef) {
              globalInputRef.focus();
            }
          }, 100);
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenFocus();
          return;
        }
        globalEventListeners.focus = unlistenFocus;

        // Listen for audio recording event
        const unlistenAudio = await listen("start-audio-recording", () => {
          if (globalAudioCallback) {
            globalAudioCallback();
          }
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenAudio();
          return;
        }
        globalEventListeners.audio = unlistenAudio;

        // Listen for screenshot trigger event with debouncing
        const unlistenScreenshot = await listen("trigger-screenshot", () => {
          const now = Date.now();
          const timeSinceLastEvent = now - lastScreenshotEventTime;

          // Debounce screenshot events (300ms minimum interval)
          if (timeSinceLastEvent < 300) {
            return;
          }

          lastScreenshotEventTime = now;

          if (globalScreenshotCallback) {
            try {
              Promise.resolve(globalScreenshotCallback())
                .catch((error) => {
                  console.error("Screenshot shortcut callback failed:", error);
                })
                .then(() => {
                  // no-op
                });
            } catch (error) {
              console.error(
                "Failed to run screenshot shortcut callback:",
                error
              );
            }
          } else {
            console.warn(
              "Screenshot shortcut triggered but no callback registered."
            );
          }
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenScreenshot();
          return;
        }
        globalEventListeners.screenshot = unlistenScreenshot;

        // Listen for system audio toggle event
        const unlistenSystemAudio = await listen("toggle-system-audio", () => {
          if (globalSystemAudioCallback) {
            globalSystemAudioCallback();
          }
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenSystemAudio();
          return;
        }
        globalEventListeners.systemAudio = unlistenSystemAudio;

        const unlistenAnswerTrigger = await listen("trigger-answer", () => {
          if (globalAnswerTriggerCallback) {
            try {
              Promise.resolve(globalAnswerTriggerCallback()).catch((error) => {
                console.error("Answer trigger shortcut callback failed:", error);
              });
            } catch (error) {
              console.error(
                "Failed to run answer trigger shortcut callback:",
                error
              );
            }
          }
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenAnswerTrigger();
          return;
        }
        globalEventListeners.answerTrigger = unlistenAnswerTrigger;

        const unlistenResponseScrollUp = await listen("scroll-response-up", () => {
          if (globalResponseScrollUpCallbacks.size > 0) {
            globalResponseScrollUpCallbacks.forEach((callback) => {
              callback();
            });
            return;
          }

          fallbackScrollActiveView(-120);
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenResponseScrollUp();
          return;
        }
        globalEventListeners.responseScrollUp = unlistenResponseScrollUp;

        const unlistenResponseScrollDown = await listen(
          "scroll-response-down",
          () => {
            if (globalResponseScrollDownCallbacks.size > 0) {
              globalResponseScrollDownCallbacks.forEach((callback) => {
                callback();
              });
              return;
            }

            fallbackScrollActiveView(120);
          }
        );
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenResponseScrollDown();
          return;
        }
        globalEventListeners.responseScrollDown = unlistenResponseScrollDown;

        // Listen for custom shortcut events
        const unlistenCustomShortcut = await listen<{ action: string }>(
          "custom-shortcut-triggered",
          (event) => {
            const actionId = event.payload.action;
            const callback = globalCustomShortcutCallbacks.get(actionId);
            if (callback) {
              callback();
            } else if (!ROUTE_HANDLED_CUSTOM_ACTIONS.has(actionId)) {
              console.warn(
                `No callback registered for custom shortcut: ${actionId}`
              );
            }
          }
        );
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenCustomShortcut();
          return;
        }
        globalEventListeners.customShortcut = unlistenCustomShortcut;

        const unlistenRegistrationError = await listen<
          Array<[string, string, string]>
        >("shortcut-registration-error", (event) => {
          window.dispatchEvent(
            new CustomEvent("shortcutRegistrationError", {
              detail: event.payload,
            })
          );
        });
        if (!isActive || !isCurrentSetup(setupGeneration)) {
          unlistenRegistrationError();
          return;
        }
        globalEventListeners.registrationError = unlistenRegistrationError;
        if (!isCurrentSetup(setupGeneration)) {
          return;
        }
        globalListenersReady = true;
      } catch (error) {
        cleanupGlobalEventListeners();
        globalListenersReady = false;
        console.error("Failed to setup event listeners:", error);
      } finally {
        globalListenersSetupInProgress = false;
      }
    };

    setupEventListeners();

    return () => {
      globalShortcutsConsumerCount = Math.max(0, globalShortcutsConsumerCount - 1);
      if (globalShortcutsConsumerCount === 0) {
        globalListenersSetupGeneration += 1;
        globalListenersSetupInProgress = false;
        globalListenersReady = false;
        isActive = false;
        cleanupGlobalEventListeners();
        clearGlobalResponseScrollCallbacks();
      }
    };
  }, []);

  return {
    checkShortcutsRegistered,
    getShortcuts,
    updateShortcuts,
    registerInputRef,
    registerAudioCallback,
    registerScreenshotCallback,
    unregisterScreenshotCallback,
    registerSystemAudioCallback,
    registerAnswerTriggerCallback,
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
    registerCustomShortcutCallback,
    unregisterCustomShortcutCallback,
  };
};
