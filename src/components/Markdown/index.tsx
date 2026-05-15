import React from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

// 💡 What: Extract static arrays and objects outside the component
// 🎯 Why: Prevents creating new object references on every render, which breaks React.memo and causes wasteful re-renders
// 📊 Impact: Significantly reduces CPU usage and re-renders for the computationally expensive Streamdown component
const SHIKI_THEME = ["github-light", "github-dark"] as const;
const STREAMDOWN_CONTROLS = {
  table: true,
  code: true,
  mermaid: {
    download: true,
    copy: true,
    fullscreen: false,
    panZoom: false,
  },
} as const;

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

function MarkdownComponent({
  children,
  isStreaming = false,
}: MarkdownRendererProps) {
  return (
    <Streamdown
      isAnimating={isStreaming}
      shikiTheme={SHIKI_THEME as any}
      components={COMPONENTS as any}
      controls={STREAMDOWN_CONTROLS}
    >
      {children}
    </Streamdown>
  );
}

export const Markdown = React.memo(MarkdownComponent);

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
