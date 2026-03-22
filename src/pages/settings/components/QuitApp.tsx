import { PowerIcon } from "lucide-react";
import { Button, Header } from "@/components";
import { tauriCommands } from "@/lib";

export const QuitApp = () => {
  const handleQuit = async () => {
    try {
      await tauriCommands.exitApp();
    } catch (error) {
      console.error("Failed to quit app:", error);
    }
  };

  return (
    <div className="space-y-3">
      <Header
        title="Quit Application"
        description="Close Ghostframe immediately from settings."
        isMainTitle
      />
      <Button
        onClick={() => {
          void handleQuit();
        }}
        variant="outline"
        className="w-full h-11"
        title="Quit application"
      >
        <PowerIcon className="h-4 w-4 mr-2" />
        Quit App
      </Button>
    </div>
  );
};
