import { GripVerticalIcon } from "lucide-react";
import { Button } from "@/components";

export const DragButton = () => {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="-ml-[2px] inline-flex min-h-8 min-w-8 items-center justify-center rounded-xl border border-border/60 text-muted-foreground"
      data-tauri-drag-region
      aria-label="Drag handle"
    >
      <GripVerticalIcon className="h-4 w-4" />
    </Button>
  );
};
