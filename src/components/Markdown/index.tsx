import React from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { BundledTheme } from "shiki";

// 💡 What: Extract static configuration objects out of render path
// 🎯 Why: Prevents creating new object references on every render
// 📊 Impact: Prevents expensive child components from re-rendering needlessly
const THEMES: [BundledTheme, BundledTheme] = ["github-light", "github-dark"];
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

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Wrap component in React.memo
// 🎯 Why: Shields expensive Markdown tree from parent re-renders when props haven't changed
// 📊 Impact: Significantly reduces UI thread blocking during app state updates
export const Markdown = React.memo(function Markdown({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={THEMES}
      components={COMPONENTS as any}
      controls={CONTROLS}
    >
      {children}
    </Streamdown>
  );
});
