import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { useOverlayScroll } from "../OverlayPanel";

const RESPONSE_SCROLL_STEP = 120; // Smaller step for smoother feel

interface ResponseViewProps {
  children: ReactNode;
}

export const ResponseView = ({ children }: ResponseViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { setScrollRef } = useOverlayScroll();
  const lastScrollTimeRef = useRef<number>(0);
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

  const scrollResponse = useCallback((delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    // Use instant scroll for repeated calls (smoother when holding key)
    const now = Date.now();
    const timeSinceLastScroll = now - lastScrollTimeRef.current;
    const behavior = timeSinceLastScroll < 200 ? "instant" : "smooth";
    lastScrollTimeRef.current = now;

    viewport.scrollBy({
      top: delta,
      behavior: behavior as ScrollBehavior,
    });
  }, []);

  const handleScrollResponseUp = useCallback(() => {
    scrollResponse(-RESPONSE_SCROLL_STEP);
  }, [scrollResponse]);

  const handleScrollResponseDown = useCallback(() => {
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
      className="flex-1 min-h-0 overflow-auto px-3 py-2 pb-12 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent scroll-smooth"
      aria-label="Response content"
    >
      {children}
    </div>
  );
};
