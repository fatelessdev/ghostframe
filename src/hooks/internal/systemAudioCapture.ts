import type { SystemAudioVadConfig } from "@/types";
import {
  isCaptureAlreadyRunningError,
  toErrorMessage,
  wait,
} from "@/hooks/internal/systemAudioUtils";

type WaitForCaptureStateOptions = {
  expected: boolean;
  timeoutMs: number;
  pollMs: number;
  getCaptureStatus: () => Promise<boolean>;
  onStatusError?: (error: unknown) => void;
};

type RestartCaptureWithRetryOptions = {
  startCapture: (args: {
    vadConfig: SystemAudioVadConfig;
    deviceId: string | null;
  }) => Promise<string>;
  stopCapture: () => Promise<string>;
  waitForState: (expected: boolean) => Promise<boolean>;
  vadConfig: SystemAudioVadConfig;
  deviceId: string | null;
  retryLimit: number;
  retryDelayMs: number;
  onAttemptFailure?: (attempt: number, retryLimit: number, message: string) => void;
};

export const waitForCaptureState = async ({
  expected,
  timeoutMs,
  pollMs,
  getCaptureStatus,
  onStatusError,
}: WaitForCaptureStateOptions): Promise<boolean> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const state = await getCaptureStatus();
      if (state === expected) {
        return true;
      }
    } catch (statusError) {
      onStatusError?.(statusError);
      return false;
    }

    await wait(pollMs);
  }

  return false;
};

export const restartSystemAudioCaptureWithRetry = async ({
  startCapture,
  stopCapture,
  waitForState,
  vadConfig,
  deviceId,
  retryLimit,
  retryDelayMs,
  onAttemptFailure,
}: RestartCaptureWithRetryOptions): Promise<void> => {
  await stopCapture();
  await waitForState(false);

  for (let attempt = 1; attempt <= retryLimit; attempt++) {
    try {
      await startCapture({
        vadConfig,
        deviceId,
      });

      const started = await waitForState(true);
      if (!started) {
        throw new Error("Backend capture did not enter running state in time.");
      }

      return;
    } catch (startError) {
      const message = toErrorMessage(startError);
      onAttemptFailure?.(attempt, retryLimit, message);

      if (!isCaptureAlreadyRunningError(startError) || attempt >= retryLimit) {
        throw startError;
      }

      await stopCapture().catch(() => {
        // no-op
      });
      await wait(retryDelayMs * attempt);
    }
  }
};
