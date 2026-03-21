import { ReactNode } from "react";
import { InterviewOverlayView } from "./types";

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
        <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl shadow-inner border border-white/5">
          <button 
            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold gap-2 transition-all ${
              viewMode === "response" 
                ? "bg-white/10 text-white shadow-sm" 
                : "text-white/50 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => onSetViewMode?.("response")}
          >
            Response 
            <div className="flex gap-0.5">
              <kbd className="bg-black/60 px-1.5 py-0.5 rounded text-[9px] text-white/50 border border-white/5">Alt</kbd>
              <kbd className="bg-black/60 px-1.5 py-0.5 rounded text-[9px] text-white/50 border border-white/5">1</kbd>
            </div>
          </button>
          <button
            className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold gap-2 transition-all ${
              viewMode === "transcripts"
                ? "bg-white/10 text-white shadow-sm"
                : "text-white/50 hover:text-white hover:bg-white/5"
            }`}
            onClick={() => onSetViewMode?.("transcripts")}
          >
            Transcripts
            <div className="flex gap-0.5">
              <kbd className="bg-black/60 px-1.5 py-0.5 rounded text-[9px] text-white/50 border border-white/5">Alt</kbd>
              <kbd className="bg-black/60 px-1.5 py-0.5 rounded text-[9px] text-white/50 border border-white/5">2</kbd>
            </div>
          </button>
        </div>
        <div className="text-white/70 text-sm font-semibold pr-2">
          {viewMode === "response" ? "AI Response" : "AI Transcripts"}
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
            className={`flex h-[max(65vh,540px)] min-h-[500px] flex-col overflow-hidden bg-black/40 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl relative pointer-events-auto ${viewMode === "settings" ? "w-full" : ""}`}
          >
            {viewMode !== "settings" && renderTabs()}
            <div className={`flex-1 relative flex flex-col ${viewMode === "settings" ? "overflow-hidden" : "p-4 pb-32 overflow-auto scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"}`}>
              {children}
            </div>

            {/* Footer constraints */}
            {viewMode !== "settings" && (
              <div className="absolute bottom-4 left-0 right-0 pointer-events-none z-10">
                <div className="flex justify-center gap-4 pointer-events-auto">
                  <button className="flex items-center gap-1.5 text-[11px] font-medium text-white/60 hover:text-white transition-colors bg-black/40 px-3 py-1.5 rounded-full border border-white/5 shadow-sm">
                    <span>Scroll Up</span>
                    <div className="flex gap-0.5">
                      <kbd className="bg-white/10 px-1 py-0.5 rounded text-[9px] border border-white/5 shadow-sm">Ctrl</kbd>
                      <kbd className="bg-white/10 px-1 py-0.5 rounded text-[9px] border border-white/5 shadow-sm">Shift</kbd>
                      <kbd className="bg-white/10 px-1 py-0.5 rounded text-[9px] border border-white/5 shadow-sm">Up</kbd>
                    </div>
                  </button>
                  <button className="flex items-center gap-1.5 text-[11px] font-medium text-white/60 hover:text-white transition-colors bg-black/40 px-3 py-1.5 rounded-full border border-white/5 shadow-sm">
                    <span>Start Over</span>
                    <div className="flex gap-0.5">
                      <kbd className="bg-white/10 px-1 py-0.5 rounded text-[9px] border border-white/5 shadow-sm">Ctrl</kbd>
                      <kbd className="bg-white/10 px-1 py-0.5 rounded text-[9px] border border-white/5 shadow-sm">G</kbd>
                    </div>
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
