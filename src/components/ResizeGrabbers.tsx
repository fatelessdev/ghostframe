import React, { useCallback, useRef } from "react";

type Direction = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizeGrabbersProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
  minWidth: number;
  minHeight: number;
}

export const ResizeGrabbers = ({ panelRef, minWidth, minHeight }: ResizeGrabbersProps) => {
  const isResizing = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ w: 0, h: 0 });
  const currentDir = useRef<Direction | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, dir: Direction) => {
      if (!panelRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      isResizing.current = true;
      currentDir.current = dir;
      startPos.current = { x: e.clientX, y: e.clientY };
      
      const rect = panelRef.current.getBoundingClientRect();
      startSize.current = { w: rect.width, h: rect.height };

      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [panelRef]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing.current || !currentDir.current || !panelRef.current) return;
      e.preventDefault();

      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;

      let newWidth = startSize.current.w;
      let newHeight = startSize.current.h;

      const dir = currentDir.current;

      if (dir.includes("e")) newWidth += dx;
      if (dir.includes("w")) {
        newWidth -= dx;
      }

      if (dir.includes("s")) newHeight += dy;
      if (dir.includes("n")) {
        newHeight -= dy;
      }

      if (newWidth < minWidth) {
        newWidth = minWidth;
      }

      if (newHeight < minHeight) {
        newHeight = minHeight;
      }

      panelRef.current.style.width = `${newWidth}px`;
      panelRef.current.style.height = `${newHeight}px`;
    },
    [minWidth, minHeight, panelRef]
  );

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing.current) return;
    isResizing.current = false;
    currentDir.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const edgeStyle = "absolute z-50 bg-transparent";

  return (
    <>
      {/* Edges */}
      <div className={`${edgeStyle} top-0 left-0 right-0 h-1.5 cursor-n-resize`} onPointerDown={(e) => handlePointerDown(e, "n")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      <div className={`${edgeStyle} bottom-0 left-0 right-0 h-1.5 cursor-s-resize`} onPointerDown={(e) => handlePointerDown(e, "s")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      <div className={`${edgeStyle} top-0 bottom-0 left-0 w-1.5 cursor-w-resize`} onPointerDown={(e) => handlePointerDown(e, "w")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      <div className={`${edgeStyle} top-0 bottom-0 right-0 w-1.5 cursor-e-resize`} onPointerDown={(e) => handlePointerDown(e, "e")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      {/* Corners */}
      <div className={`${edgeStyle} top-0 left-0 w-3 h-3 cursor-nw-resize`} onPointerDown={(e) => handlePointerDown(e, "nw")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      <div className={`${edgeStyle} top-0 right-0 w-3 h-3 cursor-ne-resize`} onPointerDown={(e) => handlePointerDown(e, "ne")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      <div className={`${edgeStyle} bottom-0 left-0 w-3 h-3 cursor-sw-resize`} onPointerDown={(e) => handlePointerDown(e, "sw")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
      <div className={`${edgeStyle} bottom-0 right-0 w-3 h-3 cursor-se-resize`} onPointerDown={(e) => handlePointerDown(e, "se")} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />
    </>
  );
};
