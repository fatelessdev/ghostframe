import { ReactNode } from "react";

interface SettingsViewProps {
  children: ReactNode;
}

export const SettingsView = ({ children }: SettingsViewProps) => {
  return <div className="flex-1 overflow-auto p-3">{children}</div>;
};
