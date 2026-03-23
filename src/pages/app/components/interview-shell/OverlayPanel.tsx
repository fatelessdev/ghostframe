import { ReactNode, useRef, createContext, useContext } from "react";
import { InterviewOverlayView } from "./types";
import { Kbd } from "@/components/ui/kbd";
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
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 pointer-events-auto">
        <div className="flex items-center gap-0.5 bg-black/30 p-0.5 rounded-lg border border-white/5">
          <button 
            className={`flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium gap-1.5 transition-all ${
              viewMode === "response" 
                ? "bg-blue-500/15 text-blue-300 border border-blue-400/20" 
                : "text-white/40 hover:text-white/70 hover:bg-white/5"
            }`}
            onClick={() => onSetViewMode?.("response")}
          >
            <span>Response</span>
            <Kbd size="sm" variant="ghost">Alt+1</Kbd>
          </button>
          <button
            className={`flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium gap-1.5 transition-all ${
              viewMode === "transcripts"
                ? "bg-blue-500/15 text-blue-300 border border-blue-400/20"
                : "text-white/40 hover:text-white/70 hover:bg-white/5"
            }`}
            onClick={() => onSetViewMode?.("transcripts")}
          >
            <span>Transcripts</span>
            <Kbd size="sm" variant="ghost">Alt+2</Kbd>
          </button>
        </div>
        <span className="text-white/40 text-[11px] font-medium">
          {viewMode === "response" ? "AI Response" : "Live Transcripts"}
        </span>
      </div>
    );
  };

  // Render footer shortcuts based on scroll state
  const renderFooterShortcuts = () => {
    const { hasOverflow, canScrollUp, canScrollDown } = scrollState;

    // No overflow = no shortcuts needed
    if (!hasOverflow) {
      return null;
    }

    return (
      <div className="absolute bottom-3 left-0 right-0 pointer-events-none z-10">
        <div className="flex justify-center gap-2 pointer-events-auto">
          {canScrollUp && (
            <div className="flex items-center gap-1.5 text-[10px] text-white/50 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/5">
              <span className="font-medium">Scroll Up</span>
              <Kbd size="sm" variant="ghost">Ctrl+Shift+Up</Kbd>
            </div>
          )}
          {canScrollDown && (
            <div className="flex items-center gap-1.5 text-[10px] text-white/50 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/5">
              <span className="font-medium">Scroll Down</span>
              <Kbd size="sm" variant="ghost">Ctrl+Shift+Down</Kbd>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[10px] text-white/50 bg-black/40 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/5">
            <span className="font-medium">Start Over</span>
            <Kbd size="sm" variant="ghost">Ctrl+G</Kbd>
          </div>
        </div>
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
              className={`flex flex-col overflow-hidden bg-black/50 backdrop-blur-xl rounded-2xl border border-white/8 shadow-2xl relative pointer-events-auto ${
                viewMode === "settings" 
                  ? "w-full h-[max(65vh,540px)] min-h-[500px]" 
                  : "min-h-[120px] max-h-[max(65vh,540px)]"
              }`}
            >
              {viewMode !== "settings" && renderTabs()}
              <div className={`flex-1 relative flex flex-col min-h-0 ${
                viewMode === "settings" 
                  ? "overflow-hidden" 
                  : "overflow-hidden"
              }`}>
                {children}
              </div>

              {/* Footer controls - only when scrollable */}
              {viewMode !== "settings" && renderFooterShortcuts()}
            </div>
          </>
        ) : null}
      </section>
    </ScrollContext.Provider>
  );
};
