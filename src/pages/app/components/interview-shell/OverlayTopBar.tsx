import {
  PlayIcon,
  SquareIcon,
  SettingsIcon,
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
    <header className="flex items-center justify-center gap-2 pointer-events-none cursor-move" data-tauri-drag-region>
      <div className="flex items-center bg-black/50 backdrop-blur-xl rounded-full px-1 py-0.5 gap-0.5 border border-white/8 pointer-events-auto shadow-lg">
        {isCapturing ? (
          <button 
            className="bg-red-500/15 border border-red-400/25 text-red-300 text-[10px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 hover:bg-red-500/25 transition-all" 
            onClick={onStartInterview}
          >
            <SquareIcon className="w-2 h-2 fill-current" />
            <span>Done</span>
          </button>
        ) : (
          <button 
            className="bg-blue-500/15 border border-blue-400/25 text-blue-300 text-[10px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5 hover:bg-blue-500/25 transition-all" 
            onClick={onStartInterview}
          >
            <PlayIcon className="w-2 h-2 fill-current" />
            <span>Start</span>
          </button>
        )}
      </div>
      
      <div className="flex items-center bg-black/50 backdrop-blur-xl rounded-full px-2.5 py-1 gap-2.5 border border-white/8 pointer-events-auto shadow-lg">
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <span className="font-medium">Screenshot</span>
          <Kbd size="sm" variant="ghost">Ctrl+S</Kbd>
        </div>
        <div className="w-px h-2.5 bg-white/10" />
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <span className="font-medium">Answer</span>
          <Kbd size="sm" variant="ghost">Ctrl+Enter</Kbd>
        </div>
        <div className="w-px h-2.5 bg-white/10" />
        <div className="flex items-center gap-1.5 text-[10px] text-white/50">
          <span className="font-medium">Hide</span>
          <Kbd size="sm" variant="ghost">Ctrl+H</Kbd>
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
