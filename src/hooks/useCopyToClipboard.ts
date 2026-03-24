import { useCallback, useRef, useState } from "react";

type UseCopyToClipboardProps = {
  text: string;
  copyMessage?: string;
};

export function useCopyToClipboard({
  text,
  copyMessage = "Copied to clipboard!",
}: UseCopyToClipboardProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const extractCodeFromMarkdown = useCallback((content: string): string => {
    const codeBlockRegex = /```[\s\S]*?\n([\s\S]*?)```/g;
    const matches = Array.from(content.matchAll(codeBlockRegex));

    if (!matches.length) {
      return content;
    }

    return matches
      .map((match) => match[1]?.trim())
      .filter((block): block is string => Boolean(block))
      .join("\n\n");
  }, []);

  const handleCopy = useCallback(() => {
    const textToCopy = extractCodeFromMarkdown(text);

    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        setIsCopied(true);
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        timeoutRef.current = setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      })
      .catch(() => {
        console.error("Failed to copy to clipboard.");
      });
  }, [copyMessage, extractCodeFromMarkdown, text]);

  return { isCopied, handleCopy };
}
