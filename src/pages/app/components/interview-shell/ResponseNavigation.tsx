import { ChevronLeft, ChevronRight } from "lucide-react";

interface ResponseNavigationProps {
  currentIndex: number;
  totalCount: number;
  onPrev: () => void;
  onNext: () => void;
  className?: string;
}

export const ResponseNavigation = ({
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  className = "",
}: ResponseNavigationProps) => {
  if (totalCount <= 1) {
    return null;
  }

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < totalCount - 1;
  const displayIndex = currentIndex + 1;

  return (
    <div
      className={`flex items-center gap-1.5 font-abel text-[11px] tracking-wide ${className}`}
      role="navigation"
      aria-label="Response navigation"
    >
      <button
        onClick={onPrev}
        disabled={!canGoPrev}
        className={`
          p-1 rounded-md transition-all duration-150
          ${canGoPrev
            ? "text-white/60 hover:text-white/90 hover:bg-white/[0.06]"
            : "text-white/20 cursor-not-allowed"
          }
        `}
        aria-label="Previous response"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      
      <span className="text-white/40 min-w-[36px] text-center tabular-nums">
        {displayIndex} / {totalCount}
      </span>
      
      <button
        onClick={onNext}
        disabled={!canGoNext}
        className={`
          p-1 rounded-md transition-all duration-150
          ${canGoNext
            ? "text-white/60 hover:text-white/90 hover:bg-white/[0.06]"
            : "text-white/20 cursor-not-allowed"
          }
        `}
        aria-label="Next response"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
