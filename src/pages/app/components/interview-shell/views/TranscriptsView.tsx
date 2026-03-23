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
      className="flex-1 min-h-0 overflow-auto px-3 py-2 pb-12 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent scroll-smooth"
      aria-label="Transcript content"
    >
      <div className="space-y-1.5">
        {orderedSegments.length === 0 ? (
          <div className="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-[11px] text-white/40 italic">
            Transcript will appear here once interview capture starts.
          </div>
        ) : (
          orderedSegments.map((segment) => {
            const isUser = segment.source === "user";

            return (
              <div
                key={segment.id}
                className={cn(
                  "max-w-[88%] rounded-xl px-2.5 py-1.5 text-[11px] border",
                  isUser
                    ? "ml-auto transcript-bubble-user"
                    : "mr-auto transcript-bubble-interviewer"
                )}
              >
                <div
                  className={cn(
                    "mb-0.5 flex items-center gap-1",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-1 w-1 rounded-full",
                      isUser ? "bg-blue-400/70" : "bg-slate-400/70"
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-[9px] text-white/30 font-medium">
                    {new Date(segment.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <p className={cn("text-white/80 leading-relaxed", segment.isLive && "animate-pulse")}>{segment.text}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
