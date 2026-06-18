import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useGlobalShortcuts } from "@/hooks";
import { Markdown } from "@/components";
import { useOverlayScroll } from "../OverlayPanel";
import type { OverlayDensity, ResponseLayoutMode } from "../types";

const RESPONSE_SCROLL_STEP = 120;
const COMPACT_SCROLL_STEP = 60;

interface ResponseViewProps {
  responseText: string;
  density?: OverlayDensity;
  layoutMode?: ResponseLayoutMode;
}

const extractCodeBlocks = (text: string): string[] => {
  const codeFenceRegex = /```(?:[\w-]+)?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match = codeFenceRegex.exec(text);

  while (match) {
    const code = match[1]?.trim();
    if (code) {
      blocks.push(code);
    }
    match = codeFenceRegex.exec(text);
  }

  return blocks;
};

const extractTextWithoutCode = (text: string): string => {
  const withoutFences = text.replace(/```(?:[\w-]+)?\n([\s\S]*?)```/g, "");
  return withoutFences.trim();
};

// 💡 What: Wrapped ResponseView in React.memo
// 🎯 Why: Shields expensive Markdown and syntax highlighting from wasteful re-renders triggered by parent OverlayPanel state changes
// 📊 Impact: Significantly reduces CPU load during UI interactions when response text hasn't changed
export const ResponseView = React.memo(({
  responseText,
  density = "normal",
  layoutMode = "default",
}: ResponseViewProps) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { setScrollRef } = useOverlayScroll();
  const isCompact = density === "compact";
  const scrollStep = isCompact ? COMPACT_SCROLL_STEP : RESPONSE_SCROLL_STEP;
  const {
    registerResponseScrollUpCallback,
    registerResponseScrollDownCallback,
    unregisterResponseScrollUpCallback,
    unregisterResponseScrollDownCallback,
  } = useGlobalShortcuts();

  const codeBlocks = useMemo(() => extractCodeBlocks(responseText), [responseText]);
  const plainText = useMemo(() => extractTextWithoutCode(responseText), [responseText]);
  const shouldSplit = layoutMode === "split" && codeBlocks.length > 0;

  useEffect(() => {
    setScrollRef(viewportRef.current);
    return () => setScrollRef(null);
  }, [setScrollRef]);

  const scrollResponse = useCallback(
    (delta: number) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      viewport.scrollBy({
        top: delta,
        behavior: "auto",
      });
    },
    []
  );

  const handleScrollResponseUp = useCallback(() => {
    scrollResponse(-scrollStep);
  }, [scrollResponse, scrollStep]);

  const handleScrollResponseDown = useCallback(() => {
    scrollResponse(scrollStep);
  }, [scrollResponse, scrollStep]);

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
      className={`
        font-abel flex-1 min-h-0 overflow-auto
        scrollbar-thin scrollbar-thumb-white/[0.08] scrollbar-track-transparent
        animate-in fade-in-0 duration-200
        ${isCompact ? "px-3 py-2 pb-4" : "px-4 py-3 pb-14"}
      `}
      role="region"
      aria-label="AI response"
      aria-live="polite"
    >
      {shouldSplit ? (
        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <section className="min-w-0 rounded-xl border border-white/[0.08] bg-black/20 p-3">
            <div className="response-text-root prose prose-sm max-w-none select-text dark:prose-invert text-body text-white/90 leading-relaxed tracking-wide">
              <Markdown>{plainText || responseText}</Markdown>
            </div>
          </section>

          <section className="min-w-0 rounded-xl border border-white/[0.08] bg-black/25 p-3 space-y-3">
            {codeBlocks.map((code, index) => (
              <pre
                key={`${index}-${code.length}`}
                className="overflow-auto rounded-md border border-white/[0.08] bg-black/40 p-3 text-[12px] leading-relaxed text-white/90"
              >
                <code>{code}</code>
              </pre>
            ))}
          </section>
        </div>
      ) : (
        <div
          className={`text-body text-white/90 leading-relaxed tracking-wide ${isCompact ? "text-[13px]" : ""}`}
        >
          <div className="response-text-root prose prose-sm max-w-none select-text dark:prose-invert">
            <Markdown>{responseText}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
});
