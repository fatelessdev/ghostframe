import { Switch, Label, Header, Kbd } from "@/components";
import { ZapIcon, SparklesIcon } from "lucide-react";
import { useApp } from "@/contexts";

interface ModelModeToggleProps {
  className?: string;
}

export const ModelModeToggle = ({ className }: ModelModeToggleProps) => {
  const { currentAIMode, setCurrentAIMode } = useApp();
  const isPro = currentAIMode === "P";

  const handleSwitchChange = (checked: boolean) => {
    setCurrentAIMode(checked ? "P" : "D");
  };

  return (
    <div id="model-mode" className={`space-y-2 ${className}`}>
      <Header
        title="AI Model Mode"
        description="Switch between Fast (cheaper, quicker) and Pro (smarter, more expensive)"
        isMainTitle
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${isPro ? "bg-amber-500/10" : "bg-blue-500/10"}`}>
            {isPro ? (
              <SparklesIcon className="w-4 h-4 text-amber-400" />
            ) : (
              <ZapIcon className="w-4 h-4 text-blue-400" />
            )}
          </div>
          <div>
            <Label className="text-sm font-medium">
              {isPro ? "Pro Mode" : "Fast Mode"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {isPro
                ? "Using advanced model for complex questions"
                : "Using lightweight model for quick responses"}
            </p>
          </div>
        </div>
        <Switch
          checked={isPro}
          onCheckedChange={handleSwitchChange}
          title={`Switch to ${isPro ? "Fast" : "Pro"} mode`}
          aria-label={`Model mode is ${isPro ? "Pro" : "Fast"}`}
        />
      </div>
      <p className="text-[10px] text-muted-foreground/70 mt-1">
        Shortcut: <Kbd size="sm" variant="ghost">Ctrl+M</Kbd> to toggle
      </p>
    </div>
  );
};
