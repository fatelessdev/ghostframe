import { ReactNode } from "react";

interface TranscriptsViewProps {
  children: ReactNode;
}

export const TranscriptsView = ({ children }: TranscriptsViewProps) => {
  return (
    <div className="flex-1 overflow-auto p-3">
      <div className="space-y-2">{children}</div>
    </div>
  );
};
