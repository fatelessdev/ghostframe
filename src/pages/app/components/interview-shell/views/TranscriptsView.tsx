import { useCallback, useEffect, useMemo, useRef } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { cn } from "@/lib/utils";
import { TranscriptSegment } from "@/types";
import { useOverlayScroll } from "../OverlayPanel";

interface TranscriptsViewProps {
  transcriptSegments: TranscriptSegment[];
}

const TRANSCRIPT_SCROLL_STEP = 120; // Smaller step for smoother feel

export const TranscriptsView = ({ transcriptSegments }: TranscriptsViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { setScrollRef } = useOverlayScroll();
  const lastScrollTimeRef = useRef<number>(0);
  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  const orderedSegments = useMemo(() => {
    return transcriptSegments.slice().sort((a, b) => a.timestamp - b.timestamp);
  }, [transcriptSegments]);

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

    viewport.scrollTo({
      top: viewport.scrollHeight,
      behavior: "smooth",
    });
  }, [orderedSegments.length]);

  const scrollTranscript = useCallback((delta: number) => {
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

  useEffect(() => {
    const handleScrollUp = () => {
      scrollTranscript(-TRANSCRIPT_SCROLL_STEP);
    };

    const handleScrollDown = () => {
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
        scroll-smooth
        animate-in fade-in-0 duration-200
      "
      role="log"
      aria-label="Live transcript"
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="space-y-2">
        {orderedSegments.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-[12px] text-white/35 tracking-wide italic">
            Transcript will appear here once interview capture starts.
          </div>
        ) : (
          orderedSegments.map((segment, index) => {
            const isUser = segment.source === "user";

            return (
              <div
                key={segment.id}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-[12px] border transition-all duration-300 ease-out",
                  "animate-in fade-in-0 slide-in-from-bottom-2",
                  isUser
                    ? "ml-auto transcript-bubble-user"
                    : "mr-auto transcript-bubble-interviewer"
                )}
                style={{ animationDelay: `${Math.min(index * 30, 150)}ms` }}
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
                      "inline-flex h-1.5 w-1.5 rounded-full transition-colors duration-200",
                      isUser ? "bg-blue-400/60" : "bg-slate-400/50",
                      segment.isLive && "animate-pulse"
                    )}
                    aria-hidden="true"
                  />
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
                    "text-white/75 leading-relaxed tracking-wide",
                    segment.isLive && "text-white/60"
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
