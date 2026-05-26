import React from "react";
import { Streamdown } from "streamdown";
import type { BundledTheme } from "shiki";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Extracted static configuration objects outside the component.
// 🎯 Why: To preserve referential equality across renders and prevent wasteful re-renders of the computationally expensive Streamdown component.
// 📊 Impact: Prevents unnecessary Markdown parsing and Shiki/KaTeX/Mermaid rendering when parent state changes.
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

const MarkdownBase = ({
  children,
  isStreaming = false,
}: MarkdownRendererProps) => {
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
};

// 💡 What: Memoized the Markdown component.
// 🎯 Why: Markdown rendering is expensive. We only want to re-render when children (content) or isStreaming changes.
// 📊 Impact: Significantly improves rendering performance in chat views with large numbers of messages.
export const Markdown = React.memo(MarkdownBase);

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
