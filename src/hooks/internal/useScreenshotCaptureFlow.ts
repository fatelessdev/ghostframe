import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { tauriCommands, tauriEvents } from "@/lib";
import type { ScreenshotConfig } from "@/types";

const SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE =
  "Screen Recording permission required. Please enable it by going to System Settings > Privacy & Security > Screen & System Audio Recording. If you don't see Ghostframe in the list, click the '+' button to add it. If it's already listed, make sure it's enabled. Then restart the app.";

type ScreenshotSubmitHandler = (
  base64: string,
  prompt?: string
) => Promise<void>;

type UseScreenshotCaptureFlowOptions = {
  handleScreenshotSubmit?: ScreenshotSubmitHandler;
  screenshotConfigRef: MutableRefObject<ScreenshotConfig>;
  hasCheckedPermissionRef: MutableRefObject<boolean>;
  isProcessingScreenshotRef: MutableRefObject<boolean>;
  screenshotInitiatedByThisContext: MutableRefObject<boolean>;
  setIsScreenshotLoading: Dispatch<SetStateAction<boolean>>;
  onScreenshotError: (message: string) => void;
};

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
};

const submitScreenshotByMode = async (
  base64: string,
  config: ScreenshotConfig,
  handleScreenshotSubmit: ScreenshotSubmitHandler
): Promise<void> => {
  if (config.mode === "auto") {
    await handleScreenshotSubmit(base64, config.autoPrompt);
    return;
  }

  await handleScreenshotSubmit(base64);
};

const ensureMacScreenRecordingPermission = async (
  hasCheckedPermissionRef: MutableRefObject<boolean>
): Promise<{ granted: boolean; error?: string }> => {
  const platform = navigator.platform.toLowerCase();

  if (!platform.includes("mac")) {
    return { granted: true };
  }

  if (hasCheckedPermissionRef.current) {
    return { granted: true };
  }

  const { checkScreenRecordingPermission, requestScreenRecordingPermission } =
    await import("tauri-plugin-macos-permissions-api");

  const hasPermission = await checkScreenRecordingPermission();
  if (hasPermission) {
    hasCheckedPermissionRef.current = true;
    return { granted: true };
  }

  await requestScreenRecordingPermission();
  await wait(2000);

  const hasPermissionNow = await checkScreenRecordingPermission();
  if (!hasPermissionNow) {
    return {
      granted: false,
      error: SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    };
  }

  hasCheckedPermissionRef.current = true;
  return { granted: true };
};

export const useScreenshotCaptureFlow = ({
  handleScreenshotSubmit,
  screenshotConfigRef,
  hasCheckedPermissionRef,
  isProcessingScreenshotRef,
  screenshotInitiatedByThisContext,
  setIsScreenshotLoading,
  onScreenshotError,
}: UseScreenshotCaptureFlowOptions) => {
  const captureScreenshot = useCallback(async () => {
    if (!handleScreenshotSubmit) {
      return;
    }

    const config = screenshotConfigRef.current;
    screenshotInitiatedByThisContext.current = true;
    setIsScreenshotLoading(true);

    try {
      const permissionResult = await ensureMacScreenRecordingPermission(
        hasCheckedPermissionRef
      );

      if (!permissionResult.granted) {
        onScreenshotError(
          permissionResult.error || "Screen recording permission is required."
        );
        screenshotInitiatedByThisContext.current = false;
        setIsScreenshotLoading(false);
        return;
      }

      if (config.enabled) {
        const base64 = await tauriCommands.captureToBase64();
        await submitScreenshotByMode(base64, config, handleScreenshotSubmit);
        screenshotInitiatedByThisContext.current = false;
        return;
      }

      isProcessingScreenshotRef.current = false;
      await tauriCommands.startScreenCapture();
    } catch {
      onScreenshotError("Failed to capture screenshot. Please try again.");
      isProcessingScreenshotRef.current = false;
      screenshotInitiatedByThisContext.current = false;
      setIsScreenshotLoading(false);
    } finally {
      if (config.enabled) {
        setIsScreenshotLoading(false);
      }
    }
  }, [
    handleScreenshotSubmit,
    hasCheckedPermissionRef,
    isProcessingScreenshotRef,
    onScreenshotError,
    screenshotConfigRef,
    screenshotInitiatedByThisContext,
    setIsScreenshotLoading,
  ]);

  useEffect(() => {
    if (!handleScreenshotSubmit) {
      return;
    }

    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void tauriEvents
      .onCapturedSelection(async (base64) => {
        if (
          !screenshotInitiatedByThisContext.current ||
          isProcessingScreenshotRef.current
        ) {
          return;
        }

        isProcessingScreenshotRef.current = true;
        const config = screenshotConfigRef.current;

        try {
          await submitScreenshotByMode(base64, config, handleScreenshotSubmit);
        } catch (error) {
          console.error("Error processing screenshot selection:", error);
        } finally {
          setIsScreenshotLoading(false);
          screenshotInitiatedByThisContext.current = false;
          window.setTimeout(() => {
            isProcessingScreenshotRef.current = false;
          }, 100);
        }
      })
      .then((fn) => {
        if (isDisposed) {
          fn();
          return;
        }

        unlisten = fn;
      })
      .catch((error) => {
        console.error("Failed to listen for captured-selection:", error);
      });

    return () => {
      isDisposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    handleScreenshotSubmit,
    isProcessingScreenshotRef,
    screenshotConfigRef,
    screenshotInitiatedByThisContext,
    setIsScreenshotLoading,
  ]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void tauriEvents
      .onCaptureClosed(() => {
        setIsScreenshotLoading(false);
        isProcessingScreenshotRef.current = false;
        screenshotInitiatedByThisContext.current = false;
      })
      .then((fn) => {
        if (isDisposed) {
          fn();
          return;
        }

        unlisten = fn;
      })
      .catch((error) => {
        console.error("Failed to listen for capture-closed:", error);
      });

    return () => {
      isDisposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [
    isProcessingScreenshotRef,
    screenshotInitiatedByThisContext,
    setIsScreenshotLoading,
  ]);

  return {
    captureScreenshot,
  };
};
