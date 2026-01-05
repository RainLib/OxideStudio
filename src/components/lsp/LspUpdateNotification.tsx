import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download, X } from "lucide-react";

export function LspUpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkForUpdates();

    // Check for updates every hour
    const interval = setInterval(checkForUpdates, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function checkForUpdates() {
    try {
      const latestVersion = await invoke<string | null>("check_lsp_updates");
      if (latestVersion) {
        setUpdateAvailable(latestVersion);
      }
    } catch (error) {
      console.error("Failed to check LSP updates:", error);
    }
  }

  if (!updateAvailable || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 max-w-md z-50">
      <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950 relative pr-12">
        <Download className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" />
        </Button>
        <AlertTitle className="text-blue-900 dark:text-blue-100">
          LSP Update Available
        </AlertTitle>
        <AlertDescription className="text-blue-700 dark:text-blue-300">
          Version {updateAvailable} is now available.
          <br />
          <a
            href={`https://github.com/LikeRainDay/lsp_sqls/releases/tag/v${updateAvailable}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline mt-2 inline-block"
          >
            View release notes →
          </a>
        </AlertDescription>
      </Alert>
    </div>
  );
}
