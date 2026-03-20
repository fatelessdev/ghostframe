import { TranscriptSegment } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  transcriptSegments: TranscriptSegment[];
};

export const RollingTranscript = ({ transcriptSegments }: Props) => {
  const text = transcriptSegments
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-8)
    .map((segment) => {
      const label = segment.source === "interviewer" ? "Interviewer" : "User";
      return `${label}: ${segment.text}`;
    })
    .join("   •   ");

  if (!text) {
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
      <p className={cn("rolling-transcript-line text-xs italic text-foreground/80")}>{text}</p>
    </div>
  );
};
