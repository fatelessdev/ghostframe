import {
  PlayIcon,
  SquareIcon,
  SettingsIcon,
  CameraIcon,
  SparklesIcon,
  EyeIcon
} from "lucide-react";
import { Kbd } from "@/components/ui/kbd";

interface OverlayTopBarProps {
  screenshotCount: number;
  mode: "D" | "P";
  contentProtectionEnabled: boolean;
  isCapturing: boolean;
  onStartInterview: () => void;
  onOpenSettings?: () => void;
  onDragHandleClick?: () => void;
}

export const OverlayTopBar = ({
  isCapturing,
  onStartInterview,
  onOpenSettings,
}: OverlayTopBarProps) => {

  return (
    <header className="flex items-center justify-center gap-2 mb-4 pointer-events-none cursor-move" data-tauri-drag-region>
      <div className="flex items-center bg-black/60 backdrop-blur-xl rounded-full px-1.5 py-1 gap-1 border border-white/10 pointer-events-auto shadow-lg">
        {isCapturing ? (
          <button 
            className="bg-red-500/20 border border-red-400/30 text-red-300 text-[11px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 hover:bg-red-500/30 transition-all shadow-sm" 
            onClick={onStartInterview}
          >
            <SquareIcon className="w-2.5 h-2.5 fill-current" />
            <span>Done</span>
          </button>
        ) : (
          <button 
            className="bg-blue-500/20 border border-blue-400/30 text-blue-300 text-[11px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 hover:bg-blue-500/30 transition-all shadow-sm" 
            onClick={onStartInterview}
          >
            <PlayIcon className="w-2.5 h-2.5 fill-current" />
            <span>Start</span>
          </button>
        )}
      </div>
      
      <div className="flex items-center bg-black/60 backdrop-blur-xl rounded-full px-3 py-1.5 gap-3 border border-white/10 pointer-events-auto shadow-lg">
        <div className="flex items-center text-[11px] text-white/70 gap-1.5 font-medium">
          <CameraIcon className="w-3 h-3 text-blue-400/80" />
          <Kbd size="sm">Ctrl+S</Kbd>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center text-[11px] text-white/70 gap-1.5 font-medium">
          <SparklesIcon className="w-3 h-3 text-blue-400/80" />
          <Kbd size="sm">Ctrl+Enter</Kbd>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <div className="flex items-center text-[11px] text-white/70 gap-1.5 font-medium">
          <EyeIcon className="w-3 h-3 text-blue-400/80" />
          <Kbd size="sm">Ctrl+H</Kbd>
        </div>
        <div className="w-px h-3 bg-white/10" />
        <button
          onClick={onOpenSettings}
          className="text-white/50 hover:text-white/90 transition-colors p-1 rounded-full hover:bg-white/10"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
