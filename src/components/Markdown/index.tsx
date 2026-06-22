import React from "react";
import { Streamdown } from "streamdown";
import type { BundledTheme } from "shiki";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Extract static objects out of component render function
// 🎯 Why: Prevents creating new object references on every render
// 📊 Impact: Prevents wasteful re-renders of the expensive Streamdown component
const SHIKI_THEMES: [BundledTheme, BundledTheme] = ["github-light", "github-dark"];
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

// 💡 What: Wrap Markdown component in React.memo
// 🎯 Why: Streamdown is computationally expensive to render
// 📊 Impact: Shields Streamdown from re-rendering when parent state changes but props remain same
export const Markdown = React.memo(function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={SHIKI_THEMES}
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
