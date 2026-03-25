import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { useOverlayScroll } from "../OverlayPanel";

const RESPONSE_SCROLL_STEP = 120;

interface ResponseViewProps {
  children: ReactNode;
}

export const ResponseView = ({ children }: ResponseViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { setScrollRef, scrollState } = useOverlayScroll();
  const canScrollUpRef = useRef(false);
  const canScrollDownRef = useRef(false);
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

    scrollResponse(-RESPONSE_SCROLL_STEP);
  }, [scrollResponse]);

  const handleScrollResponseDown = useCallback(() => {
    if (!canScrollDownRef.current) {
      return;
    }

    scrollResponse(RESPONSE_SCROLL_STEP);
  }, [scrollResponse]);

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

  return (
    <div
      ref={viewportRef}
      className="
        font-abel flex-1 min-h-0 overflow-auto 
        px-4 py-3 pb-14
        scrollbar-thin scrollbar-thumb-white/[0.08] scrollbar-track-transparent 
        animate-in fade-in-0 duration-200
      "
      role="region"
      aria-label="AI response"
      aria-live="polite"
    >
      {/* Content wrapper with refined typography */}
      <div className="text-body text-white/90 leading-relaxed tracking-wide">
        {children}
      </div>
    </div>
  );
};
