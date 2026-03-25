import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

type ClickableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const CLICKABLE_SELECTOR =
  "button, [data-tauri-drag-region], input, textarea, select, [role='button'], [role='slider'], [data-clickable-rect='true'], [data-overlay-view-mode='settings'], [data-overlay-view-mode='settings'] *";
const UPDATE_DEBOUNCE_MS = 48;

const toClickableRect = (element: Element): ClickableRect | null => {
  const rect = element.getBoundingClientRect();

  if (rect.width === 0 || rect.height === 0) {
    return null;
  }

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
};

export function useClickableRects(dependencies: unknown[] = []) {
  useEffect(() => {
    if (!document.body) {
      return;
    }

    let animationFrameId: number | null = null;
    let debounceTimeoutId: number | null = null;
    let disposed = false;
    let lastStringified = "";

    const pushRects = () => {
      animationFrameId = null;
      if (disposed) {
        return;
      }

      const rects: ClickableRect[] = Array.from(
        document.querySelectorAll(CLICKABLE_SELECTOR)
      )
        .map(toClickableRect)
        .filter((rect): rect is ClickableRect => rect !== null);

      const stringified = JSON.stringify(rects);
      if (stringified === lastStringified) {
        return;
      }

      lastStringified = stringified;
      invoke("set_clickable_rects", { rects }).catch((error) => {
        console.error("Failed to set clickable rects", error);
      });
    };

    const scheduleUpdate = () => {
      if (disposed || animationFrameId !== null) {
        return;
      }

      animationFrameId = requestAnimationFrame(pushRects);
    };

    const scheduleDebouncedUpdate = () => {
      if (disposed) {
        return;
      }

      if (debounceTimeoutId !== null) {
        clearTimeout(debounceTimeoutId);
      }

      debounceTimeoutId = window.setTimeout(() => {
        debounceTimeoutId = null;
        scheduleUpdate();
      }, UPDATE_DEBOUNCE_MS);
    };

    const mutationObserver = new MutationObserver(scheduleDebouncedUpdate);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "hidden",
        "aria-hidden",
        "data-overlay-view-mode",
        "data-state",
      ],
    });

    const resizeObserver = new ResizeObserver(scheduleDebouncedUpdate);
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(document.body);

    window.addEventListener("resize", scheduleDebouncedUpdate, { passive: true });
    document.addEventListener("scroll", scheduleDebouncedUpdate, true);

    scheduleUpdate();

    return () => {
      disposed = true;
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleDebouncedUpdate);
      document.removeEventListener("scroll", scheduleDebouncedUpdate, true);

      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }

      if (debounceTimeoutId !== null) {
        clearTimeout(debounceTimeoutId);
      }
    };
  }, dependencies);
}
