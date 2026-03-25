import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { useOverlayScroll } from "../OverlayPanel";
import { type SystemAudioLatencySnapshot } from "@/types";

const RESPONSE_SCROLL_STEP = 120;

interface ResponseViewProps {
  children: ReactNode;
  latencySnapshot?: SystemAudioLatencySnapshot;
}

export const ResponseView = ({
  children,
  latencySnapshot,
}: ResponseViewProps) => {
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

  const latencyLine = useMemo(() => {
    if (!latencySnapshot || latencySnapshot.sampleCount === 0) {
      return null;
    }

    const prompt = latencySnapshot.answerTriggerToPromptMs.p95;
    const first = latencySnapshot.answerTriggerToFirstChunkMs.p95;
    const done = latencySnapshot.answerTriggerToDoneMs.p95;
    const stream = latencySnapshot.firstChunkToDoneMs.p95;

    const renderValue = (value: number | null): string => {
      if (value === null) {
        return "--";
      }
      return `${value}ms`;
    };

    return `p95 prompt ${renderValue(prompt)} | first ${renderValue(first)} | done ${renderValue(done)} | stream ${renderValue(stream)} (${latencySnapshot.sampleCount} sample${latencySnapshot.sampleCount === 1 ? "" : "s"})`;
  }, [latencySnapshot]);

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
      {latencyLine ? (
        <div className="mb-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[10px] tracking-wide text-white/50">
          {latencyLine}
        </div>
      ) : null}

      {/* Content wrapper with refined typography */}
      <div className="text-body text-white/90 leading-relaxed tracking-wide">
        {children}
      </div>
    </div>
  );
};
