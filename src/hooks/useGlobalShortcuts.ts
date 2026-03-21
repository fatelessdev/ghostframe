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
let globalResponseScrollUpCallback: (() => void) | null = null;
let globalResponseScrollDownCallback: (() => void) | null = null;
let globalCustomShortcutCallbacks: Map<string, () => void> = new Map();

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
    // Single-consumer callback model: latest registration owns this callback.
    responseScrollUpCallbackRef.current = callback;
    globalResponseScrollUpCallback = callback;
  }, []);

  const registerResponseScrollDownCallback = useCallback((callback: () => void) => {
    // Single-consumer callback model: latest registration owns this callback.
    responseScrollDownCallbackRef.current = callback;
    globalResponseScrollDownCallback = callback;
  }, []);

  const unregisterResponseScrollUpCallback = useCallback(() => {
    const ownedCallback = responseScrollUpCallbackRef.current;
    responseScrollUpCallbackRef.current = null;

    if (
      ownedCallback &&
      globalResponseScrollUpCallback === ownedCallback
    ) {
      globalResponseScrollUpCallback = null;
    }
  }, []);

  const unregisterResponseScrollDownCallback = useCallback(() => {
    const ownedCallback = responseScrollDownCallbackRef.current;
    responseScrollDownCallbackRef.current = null;

    if (
      ownedCallback &&
      globalResponseScrollDownCallback === ownedCallback
    ) {
      globalResponseScrollDownCallback = null;
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
        if (!isActive) {
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
        if (!isActive) {
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
        if (!isActive) {
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
        if (!isActive) {
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
        if (!isActive) {
          unlistenAnswerTrigger();
          return;
        }
        globalEventListeners.answerTrigger = unlistenAnswerTrigger;

        const unlistenResponseScrollUp = await listen("scroll-response-up", () => {
          if (globalResponseScrollUpCallback) {
            globalResponseScrollUpCallback();
          }
        });
        if (!isActive) {
          unlistenResponseScrollUp();
          return;
        }
        globalEventListeners.responseScrollUp = unlistenResponseScrollUp;

        const unlistenResponseScrollDown = await listen(
          "scroll-response-down",
          () => {
            if (globalResponseScrollDownCallback) {
              globalResponseScrollDownCallback();
            }
          }
        );
        if (!isActive) {
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
            } else {
              console.warn(
                `No callback registered for custom shortcut: ${actionId}`
              );
            }
          }
        );
        if (!isActive) {
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
        if (!isActive) {
          unlistenRegistrationError();
          return;
        }
        globalEventListeners.registrationError = unlistenRegistrationError;
      } catch (error) {
        console.error("Failed to setup event listeners:", error);
      }
    };

    setupEventListeners();

    return () => {
      isActive = false;
      cleanupGlobalEventListeners();
    };
  }, []);

  return {
    checkShortcutsRegistered,
    getShortcuts,
    updateShortcuts,
    registerInputRef,
    registerAudioCallback,
    registerScreenshotCallback,
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
