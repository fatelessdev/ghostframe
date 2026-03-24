import { Switch, Label, Header } from "@/components";
import { ShieldIcon, ShieldOffIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

const CONTENT_PROTECTION_KEY = "content_protected";

interface ContentProtectionToggleProps {
  className?: string;
}

export const ContentProtectionToggle = ({ className }: ContentProtectionToggleProps) => {
  const [isProtected, setIsProtected] = useState<boolean>(true);

  useEffect(() => {
    // Read saved preference or current Rust state
    const saved = localStorage.getItem(CONTENT_PROTECTION_KEY);
    if (saved !== null) {
      setIsProtected(saved === "true");
    } else {
      invoke<boolean>("get_content_protection")
        .then((v) => setIsProtected(v))
        .catch(() => {});
    }

    // Listen for changes from other parts of the app
    const unlisten = listen<boolean>("content-protection-changed", (event) => {
      setIsProtected(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const handleSwitchChange = async (_checked: boolean) => {
    try {
      const newValue = await invoke<boolean>("toggle_content_protection");
      setIsProtected(newValue);
      localStorage.setItem(CONTENT_PROTECTION_KEY, String(newValue));
    } catch (error) {
      console.error("Failed to toggle content protection:", error);
    }
  };

  return (
    <div id="content-protection" className={`space-y-2 ${className}`}>
      <Header
        title="Content Protection"
        description="Prevent screen capture software from recording this window"
        isMainTitle
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${isProtected ? "bg-green-500/10" : "bg-yellow-500/10"}`}>
            {isProtected ? (
              <ShieldIcon className="w-4 h-4 text-green-400" />
            ) : (
              <ShieldOffIcon className="w-4 h-4 text-yellow-400" />
            )}
          </div>
          <div>
            <Label className="text-sm font-medium">
              {isProtected ? "Protection Enabled" : "Protection Disabled"}
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              {isProtected
                ? "Window is hidden from screen recording and sharing"
                : "Window may be visible in recordings and screenshots"}
            </p>
          </div>
        </div>
        <Switch
          checked={isProtected}
          onCheckedChange={handleSwitchChange}
          title={`Toggle content protection ${isProtected ? "off" : "on"}`}
          aria-label={`Content protection is ${isProtected ? "enabled" : "disabled"}`}
        />
      </div>
    </div>
  );
};
