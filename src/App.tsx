import { useEffect } from "react";
import { ThemeProvider } from "@/theme";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useShortcuts } from "@/hooks/useShortcuts";
import { WorkspacePage } from "@/pages/workspace";
import { Loader2 } from "lucide-react";
import { LspConnectionSyncer } from "@/components/lsp";
import { ErrorDisplay } from "@/components/shared";

function App() {
  // All hooks must be called before any conditional returns
  const { loadConnections, isLoading, loadError } = useConnectionStore();
  const { loadSettings } = useSettingsStore();

  // Register app-wide shortcuts (not system-wide, only when app is focused)
  useShortcuts();

  useEffect(() => {
    void loadSettings();
    void loadConnections();
  }, [loadConnections, loadSettings]);

  useEffect(() => {
    const reloadExternalSettings = () => {
      if (document.visibilityState === "visible") {
        void loadSettings();
      }
    };
    window.addEventListener("focus", reloadExternalSettings);
    document.addEventListener("visibilitychange", reloadExternalSettings);
    return () => {
      window.removeEventListener("focus", reloadExternalSettings);
      document.removeEventListener("visibilitychange", reloadExternalSettings);
    };
  }, [loadSettings]);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-foreground">
        <Loader2 className="animate-spin mr-2" /> Loading...
      </div>
    );
  }

  if (loadError) {
    return (
      <ThemeProvider>
        <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
          <ErrorDisplay
            error={loadError}
            onRetry={() => void loadConnections()}
          />
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      {/* LSP connection syncer - syncs active connection to LSP */}
      <LspConnectionSyncer />

      <div className="bg-background text-foreground h-screen w-screen overflow-hidden">
        <WorkspacePage />
      </div>
    </ThemeProvider>
  );
}

export default App;
