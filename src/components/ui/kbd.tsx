import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const kbdVariants = cva(
  "inline-flex items-center justify-center font-medium leading-none select-none",
  {
    variants: {
      variant: {
        default:
          "bg-white/10 text-white/80 rounded border border-white/15 shadow-sm",
        ghost:
          "bg-white/5 text-white/60 rounded",
        outline:
          "bg-transparent border border-white/20 text-white/70 rounded",
      },
      size: {
        default: "text-[10px] px-1.5 py-0.5 min-w-[1.25rem]",
        sm: "text-[10px] px-1 py-0.5 min-w-[1rem]",
        lg: "text-[11px] px-2 py-1 min-w-[1.5rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface KbdProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof kbdVariants> {
  /** If true, render each key as a separate badge */
  split?: boolean;
}

/**
 * Keyboard shortcut display component with icon-style rendering.
 * Automatically converts modifier keys to symbols on Mac.
 *
 * @example
 * <Kbd>Ctrl+Shift+Up</Kbd>
 * // Renders: Ctrl Shift ↑ (as separate badges when split=true)
 *
 * <Kbd split>Ctrl+Enter</Kbd>
 * // Renders: [Ctrl] [↵] (two separate badges)
 */
function Kbd({
  className,
  variant,
  size,
  split = true,
  children,
  ...props
}: KbdProps) {
  const isMac =
    typeof navigator !== "undefined" &&
    navigator.platform.toLowerCase().includes("mac");

  // Map of key names to display symbols/text
  const keyMap: Record<string, { mac: string; win: string }> = {
    mod: { mac: "⌘", win: "Ctrl" },
    ctrl: { mac: "⌃", win: "Ctrl" },
    control: { mac: "⌃", win: "Ctrl" },
    cmd: { mac: "⌘", win: "Ctrl" },
    command: { mac: "⌘", win: "Ctrl" },
    alt: { mac: "⌥", win: "Alt" },
    option: { mac: "⌥", win: "Alt" },
    shift: { mac: "⇧", win: "Shift" },
    enter: { mac: "↵", win: "↵" },
    return: { mac: "↵", win: "↵" },
    tab: { mac: "⇥", win: "Tab" },
    escape: { mac: "⎋", win: "Esc" },
    esc: { mac: "⎋", win: "Esc" },
    backspace: { mac: "⌫", win: "⌫" },
    delete: { mac: "⌦", win: "Del" },
    space: { mac: "␣", win: "Space" },
    up: { mac: "↑", win: "↑" },
    down: { mac: "↓", win: "↓" },
    left: { mac: "←", win: "←" },
    right: { mac: "→", win: "→" },
  };

  // Parse the children string into key parts
  const parseKeys = (input: string): string[] => {
    return input
      .split(/[+\s]+/)
      .map((key) => key.trim())
      .filter(Boolean);
  };

  // Convert a key to its display form
  const formatKey = (key: string): string => {
    const lowerKey = key.toLowerCase();
    const mapping = keyMap[lowerKey];
    if (mapping) {
      return isMac ? mapping.mac : mapping.win;
    }
    // Capitalize single letters, keep others as-is
    if (key.length === 1) {
      return key.toUpperCase();
    }
    return key.charAt(0).toUpperCase() + key.slice(1);
  };

  // Process children
  const renderKeys = () => {
    if (typeof children === "string") {
      const keys = parseKeys(children);
      
      if (split) {
        // Render each key as a separate badge
        return (
          <span className="inline-flex items-center gap-0.5">
            {keys.map((key, index) => (
              <kbd
                key={index}
                className={cn(kbdVariants({ variant, size }))}
              >
                {formatKey(key)}
              </kbd>
            ))}
          </span>
        );
      }
      
      // Combined badge (old behavior)
      return keys.map((key, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="opacity-40 mx-0.5">+</span>}
          <span className="inline-flex items-center justify-center min-w-[1em]">
            {formatKey(key)}
          </span>
        </React.Fragment>
      ));
    }
    return children;
  };

  // If split mode, the wrapper is just a span, badges are inside
  if (split && typeof children === "string") {
    return <span className={className} {...props}>{renderKeys()}</span>;
  }

  return (
    <kbd className={cn(kbdVariants({ variant, size, className }))} {...props}>
      {renderKeys()}
    </kbd>
  );
}

export { Kbd, kbdVariants };
