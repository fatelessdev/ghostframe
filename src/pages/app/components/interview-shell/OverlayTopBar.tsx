import {
  PlayIcon,
  SquareIcon,
  SettingsIcon,
  CameraIcon,
  ZapIcon,
  SparklesIcon,
} from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

interface OverlayTopBarProps {
  screenshotCount: number;
  mode: "D" | "P";
  contentProtectionEnabled: boolean;
  isCapturing: boolean;
  onStartInterview: () => void;
  onOpenSettings?: () => void;
  onToggleMode?: () => void;
}

export const OverlayTopBar = ({
  screenshotCount,
  mode,
  isCapturing,
  onStartInterview,
  onOpenSettings,
  onToggleMode,
}: OverlayTopBarProps) => {

  return (
    <header className="flex items-center justify-center gap-1.5 pointer-events-none cursor-move" data-tauri-drag-region>
      {/* Start/Stop Button */}
      <div className="flex items-center bg-black/50 backdrop-blur-xl rounded-full px-0.5 py-0.5 border border-white/8 pointer-events-auto shadow-lg">
        {isCapturing ? (
          <button 
            className="bg-red-500/15 border border-red-400/20 text-red-300 text-[10px] font-semibold tracking-tight px-2.5 py-1 rounded-full flex items-center gap-1.5 hover:bg-red-500/25 transition-all" 
            onClick={onStartInterview}
          >
            <SquareIcon className="w-2 h-2 fill-current" />
            <span>Done</span>
          </button>
        ) : (
          <button 
            className="bg-blue-500/15 border border-blue-400/20 text-blue-300 text-[10px] font-semibold tracking-tight px-2.5 py-1 rounded-full flex items-center gap-1.5 hover:bg-blue-500/25 transition-all" 
            onClick={onStartInterview}
          >
            <PlayIcon className="w-2 h-2 fill-current" />
            <span>Start</span>
          </button>
        )}
      </div>

      {/* Model Toggle Indicator */}
      <button
        onClick={onToggleMode}
        className="flex items-center bg-black/50 backdrop-blur-xl rounded-full px-2 py-1 gap-1.5 border border-white/8 pointer-events-auto shadow-lg hover:bg-black/60 transition-all"
      >
        {mode === "P" ? (
          <>
            <SparklesIcon className="w-2.5 h-2.5 text-amber-400" />
            <span className="text-[9px] font-semibold text-amber-300 tracking-tight">Pro</span>
          </>
        ) : (
          <>
            <ZapIcon className="w-2.5 h-2.5 text-blue-400" />
            <span className="text-[9px] font-semibold text-blue-300 tracking-tight">Fast</span>
          </>
        )}
        <Kbd size="sm" variant="ghost">Ctrl+M</Kbd>
      </button>
      
      {/* Shortcuts Bar */}
      <div className="flex items-center bg-black/50 backdrop-blur-xl rounded-full px-2 py-1 gap-2 border border-white/8 pointer-events-auto shadow-lg">
        {/* Screenshot with count */}
        <div className="flex items-center gap-1 text-[10px] text-white/50">
          <div className="relative">
            <CameraIcon className="w-3 h-3" />
            {screenshotCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-blue-500 text-white text-[8px] font-bold rounded-full min-w-[12px] h-[12px] flex items-center justify-center px-0.5 leading-none">
                {screenshotCount > 9 ? "9+" : screenshotCount}
              </span>
            )}
          </div>
          <span className="font-medium tracking-tight">Screenshot</span>
          <Kbd size="sm" variant="ghost">Ctrl+H</Kbd>
        </div>
        <div className="w-px h-2.5 bg-white/10" />
        <div className="flex items-center gap-1 text-[10px] text-white/50">
          <span className="font-medium tracking-tight">Answer</span>
          <Kbd size="sm" variant="ghost">Ctrl+Enter</Kbd>
        </div>
        <div className="w-px h-2.5 bg-white/10" />
        <button
          onClick={onOpenSettings}
          className="text-white/40 hover:text-white/80 transition-colors p-0.5 rounded-full hover:bg-white/10"
        >
          <SettingsIcon className="w-3 h-3" />
        </button>
      </div>
    </header>
  );
};
