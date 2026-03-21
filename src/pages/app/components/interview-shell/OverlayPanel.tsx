import { ReactNode } from "react";

interface OverlayPanelProps {
  children: ReactNode;
  className?: string;
}

export const OverlayPanel = ({ children, className }: OverlayPanelProps) => {
  return (
    <section
      className={`glass-card flex h-full min-h-[320px] min-w-[480px] flex-col overflow-hidden border border-input/50 bg-background shadow-lg ${className ?? ""}`}
    >
      {children}
    </section>
  );
};
