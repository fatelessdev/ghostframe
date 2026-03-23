import { useState, useCallback, useEffect, RefObject } from "react";

export interface ScrollState {
  canScrollUp: boolean;
  canScrollDown: boolean;
  hasOverflow: boolean;
  isAtTop: boolean;
  isAtBottom: boolean;
  scrollHeight: number;
  clientHeight: number;
}

const SCROLL_THRESHOLD = 2; // pixels tolerance for edge detection

export const useScrollState = (
  ref: RefObject<HTMLElement | null>
): ScrollState => {
  const [state, setState] = useState<ScrollState>({
    canScrollUp: false,
    canScrollDown: false,
    hasOverflow: false,
    isAtTop: true,
    isAtBottom: false,
    scrollHeight: 0,
    clientHeight: 0,
  });

  const updateScrollState = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = element;
    const hasOverflow = scrollHeight > clientHeight + SCROLL_THRESHOLD;
    const isAtTop = scrollTop <= SCROLL_THRESHOLD;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;

    setState({
      canScrollUp: hasOverflow && !isAtTop,
      canScrollDown: hasOverflow && !isAtBottom,
      hasOverflow,
      isAtTop,
      isAtBottom,
      scrollHeight,
      clientHeight,
    });
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    // Initial state
    updateScrollState();

    // Listen for scroll events
    element.addEventListener("scroll", updateScrollState, { passive: true });

    // Listen for content size changes
    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    resizeObserver.observe(element);

    // Also observe children for content changes
    const mutationObserver = new MutationObserver(() => {
      // Delay slightly to allow DOM to settle
      requestAnimationFrame(updateScrollState);
    });
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      element.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref, updateScrollState]);

  return state;
};
