import React from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

// 💡 What: Extracted static configuration objects and wrapped Markdown in React.memo
// 🎯 Why: Streamdown is computationally expensive. Passing inline objects/arrays causes referential equality checks to fail, triggering re-renders even when props haven't conceptually changed.
// 📊 Impact: Eliminates wasteful re-renders of the entire markdown tree when parent state changes but the message content remains identical.
const SHIKI_THEME = ["github-light", "github-dark"];
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

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

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
