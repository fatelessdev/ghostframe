import { useState } from "react";
import {
  InfoIcon,
  ChevronDownIcon,
  KeyboardIcon,
  CameraIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Warning = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  const isMac = navigator.platform.toLowerCase().includes("mac");
  const modKey = isMac ? "⌘" : "Ctrl";

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <InfoIcon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Help & Workflow</span>
        </div>
        <ChevronDownIcon
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {isExpanded ? (
        <div className="px-3 pb-3 space-y-3">
          <div className="rounded-md bg-primary/5 p-2.5 space-y-1">
            <p className="text-xs font-medium">Interview mode flow</p>
            <p className="text-[10px] text-muted-foreground">
              The app continuously transcribes both streams in real time:
              <strong> Interviewer</strong> from system audio and <strong>User</strong>{" "}
              from microphone.
            </p>
            <p className="text-[10px] text-muted-foreground">
              Press <strong>{modKey}+Enter</strong> to send current transcript +
              screenshots to AI instantly.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <KeyboardIcon className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Keyboard
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="flex items-center justify-between p-1.5 rounded bg-muted/50">
                <span className="text-muted-foreground">Send context</span>
                <kbd className="px-1.5 py-0.5 rounded bg-background border border-border font-mono">
                  {modKey}+Enter
                </kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 rounded bg-muted/50">
                <span className="text-muted-foreground">Scroll transcript</span>
                <kbd className="px-1.5 py-0.5 rounded bg-background border border-border font-mono">
                  ↑ / ↓
                </kbd>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <CameraIcon className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Screenshot context
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground rounded-md bg-muted/30 p-2">
              A screenshot is cached every 2 seconds in the background for zero
              send-time delay. Manual screenshots are additive and also attached.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <MessageSquareTextIcon className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                Transcript labels
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground rounded-md bg-muted/30 p-2">
              The AI receives source-labeled lines in chronological order:
              <br />
              Interviewer: "..."
              <br />
              User: "..."
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
};
