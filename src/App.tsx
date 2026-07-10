import { useEffect } from "react";
import { ThemeProvider } from "@/theme";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useShortcuts } from "@/hooks/useShortcuts";
import { WorkspacePage } from "@/pages/workspace";
import { Loader2 } from "lucide-react";
import { LspConnectionSyncer } from "@/components/lsp";

function App() {
  // All hooks must be called before any conditional returns
  const { loadConnections, isLoading } = useConnectionStore();

  // Register app-wide shortcuts (not system-wide, only when app is focused)
  useShortcuts();

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-foreground">
        <Loader2 className="animate-spin mr-2" /> Loading...
      </div>
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
