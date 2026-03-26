import { type MutableRefObject } from "react";
import type { AIImagePayload } from "@/types";

export type ManualScreenshot = {
  id: string;
  status: "pending" | "ready";
  image: AIImagePayload | null;
  timestamp: number;
};

export const createPendingManualScreenshot = (
  now: number = Date.now()
): ManualScreenshot => {
  return {
    id: `manual-ss-${now}-${Math.random().toString(36).slice(2, 6)}`,
    status: "pending",
    image: null,
    timestamp: now,
  };
};

export const resolveManualScreenshot = (
  screenshot: ManualScreenshot,
  image: AIImagePayload,
  now: number = Date.now()
): ManualScreenshot => {
  return {
    ...screenshot,
    status: "ready",
    image,
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
): AIImagePayload[] => {
  const IMAGE_PAYLOAD_CHAR_LIMIT = 2_400_000;
  const images: AIImagePayload[] = [];
  let usedChars = 0;

  for (let i = manualScreenshots.length - 1; i >= 0; i -= 1) {
    const screenshot = manualScreenshots[i];
    if (!screenshot || screenshot.status !== "ready" || !screenshot.image) {
      continue;
    }

    const size = screenshot.image.base64.length;
    if (images.length > 0 && usedChars + size > IMAGE_PAYLOAD_CHAR_LIMIT) {
      break;
    }

    images.push(screenshot.image);
    usedChars += size;
  }

  images.reverse();
  return images;
};
