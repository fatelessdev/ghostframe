import { useCallback, useEffect, useMemo, useRef } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { cn } from "@/lib/utils";
import { TranscriptSegment } from "@/types";
import { useOverlayScroll } from "../OverlayPanel";

interface TranscriptsViewProps {
  transcriptSegments: TranscriptSegment[];
}

const TRANSCRIPT_SCROLL_STEP = 120;
const STICKY_BOTTOM_THRESHOLD = 48;

export const TranscriptsView = ({ transcriptSegments }: TranscriptsViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { setScrollRef, scrollState } = useOverlayScroll();
  const shouldAutoStickRef = useRef(true);
  const canScrollUpRef = useRef(false);
  const canScrollDownRef = useRef(false);
  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  const orderedSegments = transcriptSegments;
  const latestSegment = orderedSegments[orderedSegments.length - 1];
  const autoStickMarker = useMemo(() => {
    if (!latestSegment) {
      return "0";
    }

    return `${orderedSegments.length}:${latestSegment.id}:${latestSegment.text}:${latestSegment.stability}:${latestSegment.isLive ? "1" : "0"}`;
  }, [latestSegment, orderedSegments.length]);

  // Register viewport ref with parent for scroll state tracking
  useEffect(() => {
    setScrollRef(viewportRef.current);
    return () => setScrollRef(null);
  }, [setScrollRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const syncAutoStick = () => {
      const distanceToBottom =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      shouldAutoStickRef.current = distanceToBottom <= STICKY_BOTTOM_THRESHOLD;
    };

    syncAutoStick();
    viewport.addEventListener("scroll", syncAutoStick, { passive: true });

    return () => {
      viewport.removeEventListener("scroll", syncAutoStick);
    };
  }, []);

  useEffect(() => {
    canScrollUpRef.current = scrollState.canScrollUp;
    canScrollDownRef.current = scrollState.canScrollDown;
  }, [scrollState.canScrollDown, scrollState.canScrollUp]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !shouldAutoStickRef.current) {
      return;
    }

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "auto",
    });
  }, [autoStickMarker]);

  const scrollTranscript = useCallback((delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollBy({
      top: delta,
      behavior: "auto",
    });
  }, []);

  useEffect(() => {
    const handleScrollUp = () => {
      if (!canScrollUpRef.current) {
        return;
      }

      scrollTranscript(-TRANSCRIPT_SCROLL_STEP);
    };

    const handleScrollDown = () => {
      if (!canScrollDownRef.current) {
        return;
      }

      scrollTranscript(TRANSCRIPT_SCROLL_STEP);
    };

    registerResponseScrollUpCallback(handleScrollUp);
    registerResponseScrollDownCallback(handleScrollDown);

    return () => {
      unregisterResponseScrollUpCallback();
      unregisterResponseScrollDownCallback();
    };
  }, [
    registerResponseScrollDownCallback,
    registerResponseScrollUpCallback,
    scrollTranscript,
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
      role="log"
      aria-label="Live transcript"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="mb-3 flex items-center justify-end gap-2 text-[10px] tracking-wide text-white/45">
        <span className="inline-flex items-center gap-1">
          <span className="text-white/35">•</span>
          interim
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-amber-300/70">~</span>
          pending
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="text-emerald-300/75">✓</span>
          final
        </span>
      </div>
      <div className="space-y-2">
        {orderedSegments.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[12px] text-white/35 tracking-wide italic">
            Transcript will appear here once interview capture starts.
          </div>
        ) : (
          orderedSegments.map((segment) => {
            const isUser = segment.source === "user";
            const stability = segment.stability || (segment.isLive ? "interim" : "final");
            const isInterim = stability === "interim";
            const isOptimistic = stability === "optimistic";
            const isFinal = stability === "final";

            return (
              <div
                key={segment.id}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-[12px] border",
                  isUser
                    ? "ml-auto transcript-bubble-user"
                    : "mr-auto transcript-bubble-interviewer"
                )}
              >
                {/* Header with source indicator and timestamp */}
                <div
                  className={cn(
                    "mb-1 flex items-center gap-1.5",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-1.5 w-1.5 rounded-full",
                      isUser ? "bg-blue-400/60" : "bg-slate-400/50",
                      isInterim && "opacity-80 animate-pulse"
                    )}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "text-[10px] tracking-wide",
                      isFinal && "text-emerald-300/70",
                      isOptimistic && "text-amber-300/65",
                      isInterim && "text-white/40"
                    )}
                    title={
                      isFinal
                        ? "Final transcript"
                        : isOptimistic
                          ? "Pending final transcript"
                          : "Interim transcript"
                    }
                  >
                    {isFinal ? "✓" : isOptimistic ? "~" : "•"}
                  </span>
                  <span className="text-[10px] text-white/25 tracking-wide">
                    {new Date(segment.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>

                {/* Transcript text */}
                <p 
                  className={cn(
                    "text-white/84 leading-relaxed tracking-wide",
                    isInterim && "text-white/65 italic",
                    isOptimistic && "text-white/76",
                    isFinal && "text-white/88"
                  )}
                >
                  {segment.text}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
