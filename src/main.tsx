import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import Overlay from "./components/Overlay";
import { AppProvider, ThemeProvider } from "./contexts";
import "./global.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppRoutes from "./routes";
import { getResponseSettings } from "./lib/storage/response-settings.storage";

let windowLabel = "main";
try {
  const currentWindow = getCurrentWindow();
  windowLabel = currentWindow.label;
} catch {
  // Tauri internals not yet available — default to "main"
}

function GlobalSettings({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const applyHighContrast = () => {
      const isHighContrast = getResponseSettings().highContrast;
      if (isHighContrast) {
        document.documentElement.classList.add("high-contrast");
      } else {
        document.documentElement.classList.remove("high-contrast");
      }
    };

    const handleStorage = () => {
      applyHighContrast();
    };

    applyHighContrast();
    window.addEventListener("responseSettingsChanged", applyHighContrast);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("responseSettingsChanged", applyHighContrast);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return <>{children}</>;
}

// Render different components based on window label
if (windowLabel.startsWith("capture-overlay-")) {
  const monitorIndex = parseInt(windowLabel.split("-")[2], 10) || 0;
  // Render overlay without providers
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <GlobalSettings>
        <Overlay monitorIndex={monitorIndex} />
      </GlobalSettings>
    </React.StrictMode>
  );
} else {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <GlobalSettings>
        <ThemeProvider>
          <AppProvider>
            <AppRoutes />
          </AppProvider>
        </ThemeProvider>
      </GlobalSettings>
    </React.StrictMode>
  );
}
