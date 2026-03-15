import { Switch, Label, Header } from "@/components";
import { useApp } from "@/contexts";
import { getPlatform } from "@/lib";

interface AppIconToggleProps {
  className?: string;
}

export const AppIconToggle = ({ className }: AppIconToggleProps) => {
  const { customizable, toggleAppIconVisibility } = useApp();
  const isWindows = getPlatform() === "windows";

  const handleSwitchChange = async (checked: boolean) => {
    await toggleAppIconVisibility(checked);
  };

  return (
    <div id="app-icon" className={`space-y-2 ${className}`}>
      <Header
        title="App Icon Stealth Mode"
        description={
          isWindows
            ? "On Windows, the main Ghostframe window is always hidden from taskbar and Alt+Tab"
            : "Control dock/taskbar icon visibility for maximum discretion"
        }
        isMainTitle
      />
      {isWindows ? (
        <div className="text-xs text-amber-600 bg-amber-500/10 p-3 rounded-md">
          Windows keeps the main overlay hidden from taskbar and Alt+Tab at all times. This setting only applies on other platforms.
        </div>
      ) : (
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {!customizable.appIcon.isVisible
                ? "Show Icon in Dock/Taskbar"
                : "Hide Icon from Dock/Taskbar"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {`Toggle to make App Icon ${
                !customizable.appIcon.isVisible ? "Visible" : "Hidden"
              }`}
            </p>
          </div>
        </div>
        <Switch
          checked={customizable.appIcon.isVisible}
          onCheckedChange={handleSwitchChange}
          aria-label="Toggle app icon visibility"
        />
      </div>
      )}
    </div>
  );
};
