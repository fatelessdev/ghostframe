import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const kbdVariants = cva(
  "inline-flex items-center justify-center gap-0.5 font-mono text-[10px] leading-none select-none",
  {
    variants: {
      variant: {
        default:
          "bg-white/10 dark:bg-white/10 text-foreground/80 px-1.5 py-1 rounded border border-white/20 dark:border-white/10",
        ghost:
          "bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded",
        outline:
          "bg-background border border-border px-1.5 py-0.5 rounded",
      },
      size: {
        default: "text-[10px] px-1.5 py-1",
        sm: "text-[9px] px-1 py-0.5",
        lg: "text-xs px-2 py-1",
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
    VariantProps<typeof kbdVariants> {}

/**
 * Keyboard shortcut display component with icon-style rendering.
 * Automatically converts modifier keys to symbols on Mac.
 *
 * @example
 * <Kbd>Ctrl+Enter</Kbd>
 * // Renders: ⌘ ↵ (on Mac) or Ctrl ↵ (on Windows)
 *
 * <Kbd keys={["mod", "shift", "k"]} />
 * // Renders: ⌘ ⇧ K (on Mac) or Ctrl ⇧ K (on Windows)
 */
function Kbd({
  className,
  variant,
  size,
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
    shift: { mac: "⇧", win: "⇧" },
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

  return (
    <kbd className={cn(kbdVariants({ variant, size, className }))} {...props}>
      {renderKeys()}
    </kbd>
  );
}

export { Kbd, kbdVariants };
