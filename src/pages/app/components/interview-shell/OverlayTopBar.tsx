import {
  PlayIcon,
  SquareIcon,
  SettingsIcon
} from "lucide-react";

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
      <div className="flex items-center bg-black/40 backdrop-blur-md rounded-full px-1.5 py-1 gap-1 border border-white/10 pointer-events-auto shadow-lg">
        {isCapturing ? (
          <button 
            className="bg-[#ef4444]/90 text-white text-[11px] font-bold px-3 py-1 rounded-[10px] flex items-center gap-1.5 hover:bg-[#ef4444] transition-colors shadow-sm" 
            onClick={onStartInterview}
          >
            Done <SquareIcon className="w-2 h-2 fill-current" />
          </button>
        ) : (
          <button 
            className="bg-[#d97706]/90 text-white text-[11px] font-bold px-3 py-1 rounded-[10px] flex items-center gap-1.5 hover:bg-[#d97706] transition-colors shadow-sm" 
            onClick={onStartInterview}
          >
            <PlayIcon className="w-2.5 h-2.5 fill-current" /> Start Interview
          </button>
        )}
      </div>
      
      <div className="flex items-center bg-black/40 backdrop-blur-md rounded-full px-3 py-1.5 gap-4 border border-white/10 pointer-events-auto shadow-lg">
        <div className="flex items-center text-[11px] text-white/80 gap-1.5 font-medium">
          <span>Take Screenshot</span>
          <div className="flex gap-0.5">
            <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans border border-white/5 shadow-sm">Ctrl</kbd>
            <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans border border-white/5 shadow-sm">S</kbd>
          </div>
        </div>
        <div className="flex items-center text-[11px] text-white/80 gap-1.5 font-medium">
          <span>Solve</span>
          <div className="flex gap-0.5">
            <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans border border-white/5 shadow-sm">Ctrl</kbd>
            <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans border border-white/5 shadow-sm">Enter</kbd>
          </div>
        </div>
        <div className="flex items-center text-[11px] text-white/80 gap-1.5 font-medium">
          <span>Show/Hide</span>
          <div className="flex gap-0.5">
            <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans border border-white/5 shadow-sm">Ctrl</kbd>
            <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans border border-white/5 shadow-sm">H</kbd>
          </div>
        </div>
        <button
          onClick={onOpenSettings}
          className="text-white/60 hover:text-white transition-colors ml-1 p-0.5 rounded-full hover:bg-white/10"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
