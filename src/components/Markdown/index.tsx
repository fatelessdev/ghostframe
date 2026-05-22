import React from "react";
import { Streamdown } from "streamdown";
import type { BundledTheme } from "shiki";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MarkdownRendererProps {
  children: string;
  isStreaming?: boolean;
}

// 💡 What: Extracted static configuration objects (themes, components, controls) outside of the render function and strongly typed shikiTheme. Wrapped Markdown in React.memo.
// 🎯 Why: To ensure referential equality across renders. Streamdown is computationally expensive (runs Shiki, Mermaid, KaTeX). Re-creating these objects on every render breaks React.memo and triggers unnecessary re-renders when parent state changes.
// 📊 Impact: Significantly reduces wasteful re-renders of the Markdown component during streaming and other parent component updates.
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
