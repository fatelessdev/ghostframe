import { ReactNode } from "react";
import { InterviewOverlayView } from "./types";
import { Kbd } from "@/components/ui/kbd";
import { ArrowUpIcon, RotateCcwIcon } from "lucide-react";

interface OverlayPanelProps {
  topBar?: ReactNode;
  children: ReactNode;
  className?: string;
  viewMode: InterviewOverlayView;
  onSetViewMode?: (view: InterviewOverlayView) => void;
}

export const OverlayPanel = ({
  topBar,
  children,
  className,
  viewMode,
  onSetViewMode,
}: OverlayPanelProps) => {
  const isExpanded = viewMode !== "collapsed";

  const renderTabs = () => {
    return (
      <div className="flex items-center justify-between p-3 border-b border-white/5 pointer-events-auto">
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl shadow-inner border border-white/5">
          <button 
            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium gap-2 transition-all ${
              viewMode === "response" 
                ? "bg-blue-500/20 text-blue-300 border border-blue-400/20 shadow-sm" 
                : "text-white/50 hover:text-white/80 hover:bg-white/5"
            }`}
            onClick={() => onSetViewMode?.("response")}
          >
            <span>Response</span>
            <Kbd size="sm" variant="ghost">Alt+1</Kbd>
          </button>
          <button
            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium gap-2 transition-all ${
              viewMode === "transcripts"
                ? "bg-blue-500/20 text-blue-300 border border-blue-400/20 shadow-sm"
                : "text-white/50 hover:text-white/80 hover:bg-white/5"
            }`}
            onClick={() => onSetViewMode?.("transcripts")}
          >
            <span>Transcripts</span>
            <Kbd size="sm" variant="ghost">Alt+2</Kbd>
          </button>
        </div>
        <div className="text-white/60 text-xs font-medium pr-2">
          {viewMode === "response" ? "AI Response" : "Live Transcripts"}
        </div>
      </div>
    );
  };

  return (
    <section
      className={`flex flex-col w-full max-w-[900px] mx-auto gap-4 ${className ?? ""} pointer-events-none`}
    >
      {topBar}
      {isExpanded ? (
        <>
          {viewMode === "settings" && (
            <div 
              className="fixed inset-0 pointer-events-auto z-[-1]" 
              onClick={() => onSetViewMode?.("collapsed")}
            />
          )}
          <div
            data-overlay-panel-body
            data-overlay-view-mode={viewMode}
            className={`flex h-[max(65vh,540px)] min-h-[500px] flex-col overflow-hidden bg-black/60 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl relative pointer-events-auto ${viewMode === "settings" ? "w-full" : ""}`}
          >
            {viewMode !== "settings" && renderTabs()}
            <div className={`flex-1 relative flex flex-col ${viewMode === "settings" ? "overflow-hidden" : "p-4 pb-32 overflow-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"}`}>
              {children}
            </div>

            {/* Footer controls */}
            {viewMode !== "settings" && (
              <div className="absolute bottom-4 left-0 right-0 pointer-events-none z-10">
                <div className="flex justify-center gap-3 pointer-events-auto">
                  <button className="flex items-center gap-2 text-[11px] font-medium text-white/50 hover:text-white/80 transition-all bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5 shadow-sm hover:bg-black/60">
                    <ArrowUpIcon className="w-3 h-3" />
                    <Kbd size="sm" variant="ghost">Ctrl+Shift+↑</Kbd>
                  </button>
                  <button className="flex items-center gap-2 text-[11px] font-medium text-white/50 hover:text-white/80 transition-all bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-white/5 shadow-sm hover:bg-black/60">
                    <RotateCcwIcon className="w-3 h-3" />
                    <Kbd size="sm" variant="ghost">Ctrl+G</Kbd>
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
};
