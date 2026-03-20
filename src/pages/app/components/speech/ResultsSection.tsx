import { CopyButton, Markdown } from "@/components";
import { Loader2, SparklesIcon } from "lucide-react";
import { TranscriptSegment } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  transcriptSegments: TranscriptSegment[];
  lastAIResponse: string;
  isAIProcessing: boolean;
  textSize: number;
};

function formatSpeaker(source: TranscriptSegment["source"]): string {
  return source === "interviewer" ? "Interviewer" : "User";
}

export const ResultsSection = ({
  transcriptSegments,
  lastAIResponse,
  isAIProcessing,
  textSize,
}: Props) => {
  const committed = transcriptSegments
    .filter((segment) => !segment.isLive)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const live = transcriptSegments
    .filter((segment) => segment.isLive)
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp);

  const hasTranscript = committed.length > 0 || live.length > 0;
  const hasResponse = !!lastAIResponse || isAIProcessing;

  if (!hasTranscript && !hasResponse) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparklesIcon className="w-3.5 h-3.5 text-primary" />
          <h4 className="text-xs font-medium">Live Transcript</h4>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {committed.length} committed / {live.length} live
        </div>
      </div>

      {hasTranscript && (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {committed.map((segment) => {
            const isUser = segment.source === "user";

            return (
              <div
                key={segment.id}
                className={cn(
                  "max-w-[92%] rounded-xl px-3 py-2 text-xs border",
                  isUser
                    ? "ml-auto bg-emerald-500/10 border-emerald-400/30"
                    : "mr-auto bg-blue-500/10 border-blue-400/30"
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wide",
                      isUser ? "text-emerald-700" : "text-blue-700"
                    )}
                  >
                    {formatSpeaker(segment.source)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(segment.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <p style={{ fontSize: `${Math.max(11, textSize - 1)}px` }}>
                  {segment.text}
                </p>
              </div>
            );
          })}

          {live.map((segment) => {
            const isUser = segment.source === "user";
            return (
              <div
                key={segment.id}
                className={cn(
                  "max-w-[92%] rounded-xl px-3 py-2 text-xs border border-dashed animate-pulse",
                  isUser
                    ? "ml-auto bg-emerald-500/5 border-emerald-400/30"
                    : "mr-auto bg-blue-500/5 border-blue-400/30"
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-wide",
                    isUser ? "text-emerald-700" : "text-blue-700"
                  )}
                >
                  {formatSpeaker(segment.source)} (live)
                </span>
                <p className="mt-1" style={{ fontSize: `${Math.max(11, textSize - 1)}px` }}>
                  {segment.text}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {(hasResponse || isAIProcessing) && (
        <div className="rounded-md border border-border/60 bg-background/60 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              AI Response
            </span>
            {lastAIResponse ? <CopyButton content={lastAIResponse} /> : null}
          </div>

          {isAIProcessing && !lastAIResponse ? (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground">Generating...</span>
            </div>
          ) : (
            <div
              className="prose prose-sm max-w-none dark:prose-invert response-markdown"
              style={{ fontSize: `${textSize}px`, lineHeight: 1.45 }}
            >
              <Markdown>{lastAIResponse}</Markdown>
              {isAIProcessing ? (
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1 align-middle" />
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
