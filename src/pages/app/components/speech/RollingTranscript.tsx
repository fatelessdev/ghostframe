import { TranscriptSegment } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  transcriptSegments: TranscriptSegment[];
};

export const RollingTranscript = ({ transcriptSegments }: Props) => {
  const recentSegments = transcriptSegments
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-8);

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
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Rolling transcript
        </span>
      </div>
      <p className={cn("rolling-transcript-line text-xs italic text-foreground/80")}>
        {recentSegments.map((segment, index) => {
          const isUser = segment.source === "user";

          return (
            <span key={segment.id} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex h-1.5 w-1.5 rounded-full",
                  isUser ? "bg-amber-500/80" : "bg-slate-400/80"
                )}
                aria-hidden="true"
              />
              <span>{segment.text}</span>
              {index < recentSegments.length - 1 ? (
                <span className="mx-1 text-foreground/50" aria-hidden="true">
                  •
                </span>
              ) : null}
            </span>
          );
        })}
      </p>
    </div>
  );
};
