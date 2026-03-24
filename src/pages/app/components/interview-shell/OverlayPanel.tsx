import { ReactNode, useRef, createContext, useContext } from "react";
import { InterviewOverlayView } from "./types";
import { useScrollState, type ScrollState } from "@/hooks";

// Context to share scroll state from child views to panel
interface ScrollContextValue {
  scrollState: ScrollState;
  setScrollRef: (ref: HTMLElement | null) => void;
}

const ScrollContext = createContext<ScrollContextValue | null>(null);

export const useOverlayScroll = () => {
  const ctx = useContext(ScrollContext);
  if (!ctx) {
    throw new Error("useOverlayScroll must be used within OverlayPanel");
  }
  return ctx;
};

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
  const scrollRef = useRef<HTMLElement | null>(null);
  const scrollState = useScrollState(scrollRef);

  const setScrollRef = (ref: HTMLElement | null) => {
    scrollRef.current = ref;
  };

  const renderTabs = () => {
    return (
      <div 
        className="font-abel flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.06] pointer-events-auto" 
        role="tablist" 
        aria-label="View tabs"
      >
        {/* Tab group with subtle inset styling */}
        <div className="flex items-center gap-1 bg-black/25 p-1 rounded-xl border border-white/[0.04]">
          <button 
            role="tab"
            aria-selected={viewMode === "response"}
            className={`
              relative flex items-center px-3 py-1.5 rounded-lg text-[12px] tracking-wide gap-2
              transition-all duration-200 ease-out outline-none
              focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent
              ${viewMode === "response" 
                ? "bg-blue-500/12 text-blue-300 shadow-sm shadow-blue-500/10" 
                : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"
              }
            `}
            onClick={() => onSetViewMode?.("response")}
          >
            {/* Active indicator bar */}
            {viewMode === "response" && (
              <span 
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-blue-400/70 rounded-full"
                aria-hidden="true"
              />
            )}
            <span className="pl-1">Response</span>
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "transcripts"}
            className={`
              relative flex items-center px-3 py-1.5 rounded-lg text-[12px] tracking-wide gap-2
              transition-all duration-200 ease-out outline-none
              focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent
              ${viewMode === "transcripts"
                ? "bg-blue-500/12 text-blue-300 shadow-sm shadow-blue-500/10"
                : "text-white/35 hover:text-white/60 hover:bg-white/[0.04]"
              }
            `}
            onClick={() => onSetViewMode?.("transcripts")}
          >
            {/* Active indicator bar */}
            {viewMode === "transcripts" && (
              <span 
                className="absolute left-1.5 top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-blue-400/70 rounded-full"
                aria-hidden="true"
              />
            )}
            <span className="pl-1">Transcripts</span>
          </button>
        </div>

        {/* Current view label */}
        <span className="text-white/30 text-[11px] tracking-wide">
          {viewMode === "response" ? "AI Response" : "Live Transcripts"}
        </span>
      </div>
    );
  };

  return (
    <ScrollContext.Provider value={{ scrollState, setScrollRef }}>
      <section
        className={`flex flex-col w-full max-w-[900px] mx-auto gap-3 ${className ?? ""} pointer-events-none`}
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
              className={`
                flex flex-col overflow-hidden overlay-panel-glass rounded-2xl 
                border border-white/[0.08] shadow-2xl relative pointer-events-auto
                animate-in fade-in-0 slide-in-from-bottom-3 duration-300 ease-out
                ${viewMode === "settings" 
                  ? "w-full h-[max(65vh,540px)] min-h-[500px]" 
                  : "min-h-[120px] max-h-[max(65vh,540px)]"
                }
              `}
            >
              {viewMode !== "settings" && renderTabs()}
              <div className="flex-1 relative flex flex-col min-h-0 overflow-hidden">
                {children}
              </div>

            </div>
          </>
        ) : null}
      </section>
    </ScrollContext.Provider>
  );
};
