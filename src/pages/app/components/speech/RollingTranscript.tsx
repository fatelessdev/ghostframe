import { TranscriptSegment } from "@/types";

type Props = {
  transcriptSegments: TranscriptSegment[];
};

export const RollingTranscript = ({ transcriptSegments }: Props) => {
  const recentSegments = transcriptSegments.slice(-8);

  if (recentSegments.length === 0) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <p className="text-xs text-muted-foreground italic">
          Live transcript appears here...
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 overflow-hidden">
      <div className="flex items-center gap-2 mb-1">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500/80" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Rolling transcript
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs italic text-foreground/80 leading-relaxed">
        {recentSegments.map((segment, index) => {
          const stability = segment.stability || (segment.isLive ? "interim" : "final");
          const isInterim = stability === "interim";
          const isOptimistic = stability === "optimistic";
          const isFinal = stability === "final";

          return (
            <span key={segment.id} className="inline-flex items-center gap-1.5">
              <span
                className={
                  isInterim
                    ? "text-foreground/65 italic animate-pulse"
                    : isOptimistic
                      ? "text-foreground/78 animate-pulse"
                      : "text-foreground/90"
                }
              >
                {segment.text}
              </span>
              <span
                className={
                  isFinal
                    ? "text-emerald-400/70"
                    : isOptimistic
                      ? "text-amber-400/65 animate-pulse"
                      : "text-foreground/35 animate-pulse"
                }
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
              {index < recentSegments.length - 1 ? (
                <span className="mx-1 text-foreground/50" aria-hidden="true">
                  •
                </span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
};
