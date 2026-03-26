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
        <div className="ml-auto hidden items-center gap-2 text-[9px] tracking-wide text-muted-foreground/70 sm:inline-flex">
          <span className="inline-flex items-center gap-0.5">
            <span className="text-foreground/35">•</span>
            interim
          </span>
          <span className="inline-flex items-center gap-0.5">
            <span className="text-amber-400/70">~</span>
            pending
          </span>
          <span className="inline-flex items-center gap-0.5">
            <span className="text-emerald-400/75">✓</span>
            final
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs italic text-foreground/80 leading-relaxed">
        {recentSegments.map((segment, index) => {
          const isUser = segment.source === "user";
          const stability = segment.stability || (segment.isLive ? "interim" : "final");
          const isInterim = stability === "interim";
          const isOptimistic = stability === "optimistic";
          const isFinal = stability === "final";

          return (
            <span key={segment.id} className="inline-flex items-center gap-1.5">
              <span
                className={`inline-flex h-1.5 w-1.5 rounded-full ${
                  isUser ? "bg-blue-400/80" : "bg-slate-400/80"
                } ${isInterim ? "animate-pulse opacity-80" : ""}`}
                aria-hidden="true"
              />
              <span
                className={
                  isInterim
                    ? "text-foreground/65 italic"
                    : isOptimistic
                      ? "text-foreground/78"
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
                      ? "text-amber-400/65"
                      : "text-foreground/35"
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
