import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";

type ClickableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function useClickableRects(dependencies: unknown[] = []) {
  useEffect(() => {
    let animationFrameId: number;
    let lastStringified = "";

    const updateRects = () => {
      const elements = document.querySelectorAll(
        "button, [data-tauri-drag-region], input, textarea, select, [role='button'], [data-clickable-rect='true']"
      );

      const rects: ClickableRect[] = Array.from(elements)
        .map((element) => {
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
        })
        .filter((rect): rect is ClickableRect => rect !== null);

      const stringified = JSON.stringify(rects);
      if (stringified !== lastStringified) {
        lastStringified = stringified;
        invoke("set_clickable_rects", { rects }).catch((error) => {
          console.error("Failed to set clickable rects", error);
        });
      }

      animationFrameId = requestAnimationFrame(updateRects);
    };

    animationFrameId = requestAnimationFrame(updateRects);

    return () => cancelAnimationFrame(animationFrameId);
  }, dependencies);
}
