import { CopyButton, Markdown } from "@/components";
import { Loader2 } from "lucide-react";
import { TranscriptSegment } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  transcriptSegments: TranscriptSegment[];
  lastAIResponse: string;
  isAIProcessing: boolean;
  textSize: number;
};

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
      {hasTranscript ? (
        <div className="flex items-center justify-end">
          <div className="text-[10px] text-muted-foreground">
            {committed.length} committed / {live.length} live
          </div>
        </div>
      ) : null}

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
                    ? "ml-auto transcript-bubble-user"
                    : "mr-auto transcript-bubble-interviewer"
                )}
              >
                <div
                  className={cn(
                    "mb-1 flex items-center",
                    isUser ? "justify-end" : "justify-start"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-1.5 w-1.5 rounded-full",
                      isUser ? "bg-amber-500/70" : "bg-slate-400/70"
                    )}
                    aria-hidden="true"
                  />
                </div>
                <p style={{ fontSize: `${Math.max(11, textSize - 1)}px` }}>
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
