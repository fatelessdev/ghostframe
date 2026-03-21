import { ReactNode } from "react";
import { InterviewOverlayView } from "./types";

interface OverlayPanelProps {
  topBar?: ReactNode;
  children: ReactNode;
  className?: string;
  viewMode: InterviewOverlayView;
}

export const OverlayPanel = ({
  topBar,
  children,
  className,
  viewMode,
}: OverlayPanelProps) => {
  const isExpanded = viewMode !== "collapsed";

  return (
    <section
      className={`overlay-panel-shell flex min-w-[480px] flex-col overflow-hidden ${isExpanded ? "overlay-panel-expanded" : "overlay-panel-collapsed"} ${className ?? ""}`}
    >
      {topBar}
      {isExpanded ? (
        <div
          data-overlay-panel-body
          data-overlay-view-mode={viewMode}
          className="overlay-panel-glass flex h-[min(58vh,540px)] min-h-0 flex-col overflow-hidden"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
};
