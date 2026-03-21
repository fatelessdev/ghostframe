import { useCallback, useEffect, useMemo, useRef } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { cn } from "@/lib/utils";
import { TranscriptSegment } from "@/types";

interface TranscriptsViewProps {
  transcriptSegments: TranscriptSegment[];
}

const TRANSCRIPT_SCROLL_STEP = 180;

export const TranscriptsView = ({ transcriptSegments }: TranscriptsViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  const orderedSegments = useMemo(() => {
    return transcriptSegments.slice().sort((a, b) => a.timestamp - b.timestamp);
  }, [transcriptSegments]);

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

    viewport.scrollBy({
      top: delta,
      behavior: "smooth",
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
      className="h-full min-h-0 overflow-auto p-3"
      aria-label="Transcript content"
    >
      <div className="space-y-2">
        {orderedSegments.length === 0 ? (
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground italic">
            Transcript will appear here once interview capture starts.
          </div>
        ) : (
          orderedSegments.map((segment) => {
            const isUser = segment.source === "user";

            return (
              <div
                key={segment.id}
                className={cn(
                  "max-w-[92%] rounded-xl px-3 py-2 text-xs border",
                  isUser
                    ? "ml-auto transcript-bubble-user"
                    : "mr-auto transcript-bubble-interviewer"
                )}
              >
                <div
                  className={cn(
                    "mb-1 flex items-center gap-1.5",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-1.5 w-1.5 rounded-full",
                      isUser ? "bg-amber-500/80" : "bg-slate-400/80"
                    )}
                    aria-hidden="true"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(segment.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <p className={segment.isLive ? "animate-pulse" : ""}>{segment.text}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
