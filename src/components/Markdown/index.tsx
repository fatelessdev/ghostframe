import React, { memo } from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { BundledTheme } from "shiki";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Extracted static configuration objects outside the component
// 🎯 Why: Prevent recreating identical configuration objects on every render, ensuring referential equality
// 📊 Impact: Significantly reduces wasteful re-renders of the heavy Streamdown component
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

// 💡 What: Wrapped Markdown in React.memo
// 🎯 Why: Shields the computationally expensive markdown rendering tree from unrelated parent updates
// 📊 Impact: Prevents costly re-parsing and re-rendering of large text blocks when overlay state changes
export const Markdown = memo(function Markdown({
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
