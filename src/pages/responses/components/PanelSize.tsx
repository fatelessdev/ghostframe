import { Header, Label, Slider } from "@/components";
import { getResponseSettings, updateResponsePanelSize } from "@/lib";
import { useEffect, useState } from "react";

const MIN_PANEL_WIDTH = 480;
const MAX_PANEL_WIDTH = 1200;
const MIN_PANEL_HEIGHT = 320;
const MAX_PANEL_HEIGHT = 900;

export const PanelSize = () => {
  const [panelWidth, setPanelWidth] = useState(MIN_PANEL_WIDTH);
  const [panelHeight, setPanelHeight] = useState(MIN_PANEL_HEIGHT);

  useEffect(() => {
    const syncPanelSize = () => {
      const settings = getResponseSettings();
      setPanelWidth(settings.panelWidth);
      setPanelHeight(settings.panelHeight);
    };

    syncPanelSize();
    window.addEventListener("storage", syncPanelSize);
    window.addEventListener("responseSettingsChanged", syncPanelSize);

    return () => {
      window.removeEventListener("storage", syncPanelSize);
      window.removeEventListener("responseSettingsChanged", syncPanelSize);
    };
  }, []);

  const handleWidthChange = (value: number[]) => {
    const nextWidth = value[0] ?? panelWidth;
    setPanelWidth(nextWidth);
    updateResponsePanelSize(nextWidth, panelHeight);
  };

  const handleHeightChange = (value: number[]) => {
    const nextHeight = value[0] ?? panelHeight;
    setPanelHeight(nextHeight);
    updateResponsePanelSize(panelWidth, nextHeight);
  };

  return (
    <div className="space-y-4">
      <Header
        title="Panel Size"
        description="Adjust the shared response and interview panel dimensions."
        isMainTitle
      />

      <div className="rounded-xl border p-4 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Panel width</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {panelWidth}px
              </p>
            </div>
          </div>
          <Slider
            min={MIN_PANEL_WIDTH}
            max={MAX_PANEL_WIDTH}
            step={20}
            value={[panelWidth]}
            onValueChange={handleWidthChange}
            aria-label="Response panel width"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Panel height</Label>
              <p className="text-xs text-muted-foreground mt-1">
                {panelHeight}px
              </p>
            </div>
          </div>
          <Slider
            min={MIN_PANEL_HEIGHT}
            max={MAX_PANEL_HEIGHT}
            step={20}
            value={[panelHeight]}
            onValueChange={handleHeightChange}
            aria-label="Response panel height"
          />
        </div>

        <p className="text-xs text-muted-foreground/70">
          These values are used by both the AI response and system audio views.
        </p>
      </div>
    </div>
  );
};
