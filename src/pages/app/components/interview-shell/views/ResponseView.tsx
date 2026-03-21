import { ReactNode } from "react";

interface ResponseViewProps {
  children: ReactNode;
}

export const ResponseView = ({ children }: ResponseViewProps) => {
  return <div className="flex-1 overflow-auto p-3">{children}</div>;
};
