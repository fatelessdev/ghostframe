import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useGlobalShortcuts } from "@/hooks";

const RESPONSE_SCROLL_STEP = 180;

interface ResponseViewProps {
  children: ReactNode;
}

export const ResponseView = ({ children }: ResponseViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  const scrollResponse = useCallback((delta: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    viewport.scrollBy({
      top: delta,
      behavior: "smooth",
    });
  }, []);

  const handleScrollResponseUp = useCallback(() => {
    scrollResponse(-RESPONSE_SCROLL_STEP);
  }, [scrollResponse]);

  const handleScrollResponseDown = useCallback(() => {
    scrollResponse(RESPONSE_SCROLL_STEP);
  }, [scrollResponse]);

  useEffect(() => {
    registerResponseScrollUpCallback(handleScrollResponseUp);
    registerResponseScrollDownCallback(handleScrollResponseDown);

    return () => {
      unregisterResponseScrollUpCallback();
      unregisterResponseScrollDownCallback();
    };
  }, [
    handleScrollResponseDown,
    handleScrollResponseUp,
    registerResponseScrollDownCallback,
    registerResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
  ]);

  return (
    <div
      ref={viewportRef}
      className="flex-1 overflow-auto p-3"
      aria-label="Response content"
    >
      {children}
    </div>
  );
};
