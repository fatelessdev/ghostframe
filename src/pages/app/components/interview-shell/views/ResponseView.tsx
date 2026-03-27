import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { useOverlayScroll } from "../OverlayPanel";
import type { OverlayDensity, ResponseLayoutMode } from "../types";

const RESPONSE_SCROLL_STEP = 120;
const COMPACT_SCROLL_STEP = 60;

interface ResponseViewProps {
  children: ReactNode;
  density?: OverlayDensity;
  layoutMode?: ResponseLayoutMode;
  codeContent?: ReactNode;
  textContent?: ReactNode;
}

export const ResponseView = ({
  children,
  density = "normal",
  layoutMode = "default",
  codeContent,
  textContent,
}: ResponseViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const codeViewportRef = useRef<HTMLDivElement | null>(null);
  const { setScrollRef, scrollState } = useOverlayScroll();
  const canScrollUpRef = useRef(false);
  const canScrollDownRef = useRef(false);
  const isCompact = density === "compact";
  const isSplit = layoutMode === "split";
  const scrollStep = isCompact ? COMPACT_SCROLL_STEP : RESPONSE_SCROLL_STEP;
  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  // Register viewport ref with parent for scroll state tracking
  useEffect(() => {
    setScrollRef(viewportRef.current);
    return () => setScrollRef(null);
  }, [setScrollRef]);

  useEffect(() => {
    canScrollUpRef.current = scrollState.canScrollUp;
    canScrollDownRef.current = scrollState.canScrollDown;
  }, [scrollState.canScrollDown, scrollState.canScrollUp]);

  const scrollResponse = useCallback((delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollBy({
      top: delta,
      behavior: "auto",
    });
  }, []);

  const handleScrollResponseUp = useCallback(() => {
    if (!canScrollUpRef.current) {
      return;
    }

    scrollResponse(-scrollStep);
  }, [scrollResponse, scrollStep]);

  const handleScrollResponseDown = useCallback(() => {
    if (!canScrollDownRef.current) {
      return;
    }

    scrollResponse(scrollStep);
  }, [scrollResponse, scrollStep]);

  useEffect(() => {
    registerResponseScrollUpCallback(handleScrollResponseUp);
    registerResponseScrollDownCallback(handleScrollResponseDown);

    return () => {
      unregisterResponseScrollUpCallback();
      unregisterResponseScrollDownCallback();
    };
  }, [
    handleScrollResponseDown,
    handleScrollResponseUp,
    registerResponseScrollDownCallback,
    registerResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
  ]);

  // Split layout: show code in left pane, text in right pane
  if (isSplit && codeContent && textContent) {
    return (
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Code pane */}
        <div
          ref={codeViewportRef}
          className="
            w-1/2 overflow-auto border-r border-white/[0.06]
            scrollbar-thin scrollbar-thumb-white/[0.08] scrollbar-track-transparent
          "
        >
          <div className="p-3 text-body text-white/90">
            {codeContent}
          </div>
        </div>
        {/* Text pane */}
        <div
          ref={viewportRef}
          className={`
            w-1/2 overflow-auto
            scrollbar-thin scrollbar-thumb-white/[0.08] scrollbar-track-transparent
            ${isCompact ? "px-3 py-2" : "px-4 py-3"}
          `}
        >
          <div className="text-body text-white/90 leading-relaxed tracking-wide">
            {textContent}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={viewportRef}
      className={`
        font-abel flex-1 min-h-0 overflow-auto 
        scrollbar-thin scrollbar-thumb-white/[0.08] scrollbar-track-transparent 
        animate-in fade-in-0 duration-200
        ${isCompact ? "px-3 py-2 pb-4" : "px-4 py-3 pb-14"}
      `}
      role="region"
      aria-label="AI response"
      aria-live="polite"
    >
      {/* Content wrapper with refined typography */}
      <div className={`text-body text-white/90 leading-relaxed tracking-wide ${isCompact ? "text-[13px]" : ""}`}>
        {children}
      </div>
    </div>
  );
};
