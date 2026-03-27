import { useState, useCallback, useEffect, useRef } from "react";

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

const DEFAULT_SCROLL_STATE: ScrollState = {
  canScrollUp: false,
  canScrollDown: false,
  hasOverflow: false,
  isAtTop: true,
  isAtBottom: false,
  scrollHeight: 0,
  clientHeight: 0,
};

export const useScrollState = (
  target: HTMLElement | null
): ScrollState => {
  const frameRef = useRef<number | null>(null);
  const [state, setState] = useState<ScrollState>(DEFAULT_SCROLL_STATE);

  const updateScrollState = useCallback(() => {
    const element = target;
    if (!element) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = element;
    const hasOverflow = scrollHeight > clientHeight + SCROLL_THRESHOLD;
    const isAtTop = scrollTop <= SCROLL_THRESHOLD;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;

    const nextState: ScrollState = {
      canScrollUp: hasOverflow && !isAtTop,
      canScrollDown: hasOverflow && !isAtBottom,
      hasOverflow,
      isAtTop,
      isAtBottom,
      scrollHeight,
      clientHeight,
    };

    setState((previous) => {
      if (
        previous.canScrollUp === nextState.canScrollUp &&
        previous.canScrollDown === nextState.canScrollDown &&
        previous.hasOverflow === nextState.hasOverflow &&
        previous.isAtTop === nextState.isAtTop &&
        previous.isAtBottom === nextState.isAtBottom &&
        previous.scrollHeight === nextState.scrollHeight &&
        previous.clientHeight === nextState.clientHeight
      ) {
        return previous;
      }

      return nextState;
    });
  }, [target]);

  useEffect(() => {
    const element = target;
    if (!element) {
      setState((previous) => {
        if (
          previous.canScrollUp === DEFAULT_SCROLL_STATE.canScrollUp &&
          previous.canScrollDown === DEFAULT_SCROLL_STATE.canScrollDown &&
          previous.hasOverflow === DEFAULT_SCROLL_STATE.hasOverflow &&
          previous.isAtTop === DEFAULT_SCROLL_STATE.isAtTop &&
          previous.isAtBottom === DEFAULT_SCROLL_STATE.isAtBottom &&
          previous.scrollHeight === DEFAULT_SCROLL_STATE.scrollHeight &&
          previous.clientHeight === DEFAULT_SCROLL_STATE.clientHeight
        ) {
          return previous;
        }

        return DEFAULT_SCROLL_STATE;
      });
      return;
    }

    const scheduleUpdate = () => {
      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateScrollState();
      });
    };

    scheduleUpdate();

    element.addEventListener("scroll", scheduleUpdate, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      scheduleUpdate();
    });
    resizeObserver.observe(element);

    const mutationObserver = new MutationObserver(() => {
      scheduleUpdate();
    });
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      element.removeEventListener("scroll", scheduleUpdate);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [target, updateScrollState]);

  return state;
};
