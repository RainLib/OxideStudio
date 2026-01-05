import { useEffect } from "react";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { useConnectionStore } from "@/store/useConnectionStore";
import { WorkspaceLayout } from "@/components/connection/WorkspaceLayout";
import { LspBinaryManager, LspUpdateNotification } from "@/components/lsp";

function App() {
  const { activeConnectionId, loadConnections, isLoading } =
    useConnectionStore();

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
      <div className="bg-background text-foreground h-screen w-screen overflow-hidden">
        {isConnected ? <WorkspacePage /> : <ConnectionPage />}
      </div>
    </ThemeProvider>
  );
}

export default App;
