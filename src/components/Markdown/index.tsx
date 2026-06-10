import React, { memo } from "react";
import { Streamdown } from "streamdown";
import type { BundledTheme } from "shiki";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Statically extract SHIKI_THEME array outside the component
// 🎯 Why: Prevents creating a new array reference on every render
// 📊 Impact: Prevents wasteful re-renders of the Streamdown component
const SHIKI_THEME: [BundledTheme, BundledTheme] = ["github-light", "github-dark"];

// 💡 What: Statically extract CONTROLS object outside the component
// 🎯 Why: Prevents creating a new object reference on every render
// 📊 Impact: Prevents wasteful re-renders of the Streamdown component
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

// 💡 What: Wrap Markdown with React.memo
// 🎯 Why: Markdown rendering is expensive (Streamdown, Shiki, Mermaid, KaTeX)
// 📊 Impact: Shields the expensive subtree from wasteful re-renders when parent state changes but children remain equal
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
