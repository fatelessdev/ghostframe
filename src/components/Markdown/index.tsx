import React from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { BundledTheme } from "shiki";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Extract static configurations outside the component and type strictly
// 🎯 Why: To ensure referential equality across renders, preventing `Streamdown` from wasteful re-rendering
const SHIKI_THEME: [BundledTheme, BundledTheme] = ["github-light", "github-dark"];

const CONTROLS = {
  table: true,
  code: true,
  mermaid: {
    download: true,
    copy: true,
    fullscreen: false,
    panZoom: false,
  },
};

const COMPONENTS = {
  a: ({ children, href, ...props }: any) => {
    const handleClick = async (e: React.MouseEvent) => {
      e.preventDefault();
      if (href) {
        try {
          await openUrl(href);
        } catch (error) {
          console.error("Failed to open URL:", error);
        }
      }
    };

    return (
      <a
        href={href}
        className="text-gray-600 underline underline-offset-2 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 cursor-pointer"
        onClick={handleClick}
        {...props}
      >
        {children}
      </a>
    );
  },
};

// 💡 What: Apply React.memo to the Markdown component
// 🎯 Why: Markdown rendering with streamdown/shiki is computationally expensive. Memoization prevents re-renders when parent component state updates but props remain the same.
// 📊 Impact: Significantly reduces UI thread blocking and CPU usage during parent component re-renders (e.g. during rapid state changes or typing in other parts of the view).
export const Markdown = React.memo(function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={SHIKI_THEME}
      components={COMPONENTS as any}
      controls={CONTROLS}
    >
      {children}
    </Streamdown>
  );
});
