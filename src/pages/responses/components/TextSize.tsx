import { Header, Label, Slider } from "@/components";
import { getResponseSettings, updateTextSize } from "@/lib";
import { useEffect, useState } from "react";

const MIN_TEXT_SIZE = 10;
const MAX_TEXT_SIZE = 32;

export const TextSize = () => {
  const [textSize, setTextSize] = useState<number>(15);

  useEffect(() => {
    const settings = getResponseSettings();
    setTextSize(settings.textSize);
  }, []);

  const handleValueChange = (value: number[]) => {
    const nextTextSize = value[0] ?? textSize;
    setTextSize(nextTextSize);
    updateTextSize(nextTextSize);
  };

  return (
    <div className="space-y-4">
      <Header
        title="Response Text Size"
        description="Increase or decrease the answer text size for easier reading. This applies immediately to the answer panel and conversation history."
        isMainTitle
      />

      <div className="rounded-xl border p-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Text size</Label>
            <p className="text-xs text-muted-foreground mt-1">
              {textSize}px
            </p>
          </div>
          <div
            className="rounded-md border bg-muted/40 px-3 py-2 text-muted-foreground"
            style={{ fontSize: `${textSize}px`, lineHeight: 1.45 }}
          >
            Preview the answer density here.
          </div>
        </div>

        <Slider
          min={MIN_TEXT_SIZE}
          max={MAX_TEXT_SIZE}
          step={1}
          value={[textSize]}
          onValueChange={handleValueChange}
          aria-label="Response text size"
        />
      </div>
    </div>
  );
};