import { type MutableRefObject } from "react";

export type ManualScreenshot = {
  id: string;
  base64: string;
  timestamp: number;
};

export const createManualScreenshot = (
  base64: string,
  now: number = Date.now()
): ManualScreenshot => {
  return {
    id: `manual-ss-${now}-${Math.random().toString(36).slice(2, 6)}`,
    base64,
    timestamp: now,
  };
};

export const appendManualScreenshot = (
  previous: ManualScreenshot[],
  screenshot: ManualScreenshot,
  maxManualScreenshots: number
): ManualScreenshot[] => {
  return [...previous, screenshot].slice(-maxManualScreenshots);
};

export const clearManualScreenshotsState = (
  previous: ManualScreenshot[],
  manualScreenshotsRef: MutableRefObject<ManualScreenshot[]>
): ManualScreenshot[] => {
  if (previous.length === 0) {
    manualScreenshotsRef.current = previous;
    return previous;
  }

  manualScreenshotsRef.current = [];
  return [];
};

export const buildImagesPayload = (
  manualScreenshots: ManualScreenshot[]
): string[] => {
  const images: string[] = [];

  for (const screenshot of manualScreenshots) {
    images.push(screenshot.base64);
  }

  return images;
};
