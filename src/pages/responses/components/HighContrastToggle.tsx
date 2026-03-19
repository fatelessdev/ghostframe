import { Switch, Label, Header } from "@/components";
import { useState, useEffect } from "react";
import { getResponseSettings, updateHighContrast } from "@/lib";

export const HighContrastToggle = () => {
  const [highContrast, setHighContrast] = useState<boolean>(false);

  useEffect(() => {
    const settings = getResponseSettings();
    setHighContrast(settings.highContrast);

    const handleSettingsChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.highContrast !== undefined) {
        setHighContrast(customEvent.detail.highContrast);
      } else {
        setHighContrast(getResponseSettings().highContrast);
      }
    };

    window.addEventListener("responseSettingsChanged", handleSettingsChange);
    return () => window.removeEventListener("responseSettingsChanged", handleSettingsChange);
  }, []);

  const handleSwitchChange = (checked: boolean) => {
    setHighContrast(checked);
    updateHighContrast(checked);
  };

  return (
    <div className="space-y-4">
      <Header
        title="High Contrast Mode"
        description="Enable high contrast mode to make the app more legible. This setting applies immediately."
      />

      <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {highContrast ? "High Contrast Enabled" : "High Contrast Disabled"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {highContrast
                ? "The application UI is using a high contrast theme"
                : "The application UI is using the default theme"}
            </p>
          </div>
        </div>
        <Switch
          checked={highContrast}
          onCheckedChange={handleSwitchChange}
          title={`Toggle to ${!highContrast ? "enable" : "disable"} high contrast`}
          aria-label={`Toggle to ${
            highContrast ? "disable" : "enable"
          } high contrast`}
        />
      </div>
    </div>
  );
};