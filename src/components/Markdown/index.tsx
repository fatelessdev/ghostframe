import React from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Extract static configurations outside the component
// 🎯 Why: Prevents creating new array/object references on every render, which would otherwise defeat React.memo
// 📊 Impact: Reduces memory allocation and allows Streamdown to skip re-renders when props are unchanged
const SHIKI_THEME: ["github-light", "github-dark"] = ["github-light", "github-dark"];
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

// 💡 What: Wrap Markdown component with React.memo
// 🎯 Why: Markdown rendering (with shiki, streamdown, mermaid) is computationally expensive
// 📊 Impact: Prevents wasteful re-renders during parent component updates when children/isStreaming haven't changed
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
