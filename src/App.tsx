import { useEffect } from "react";
import { ThemeProvider } from "@/theme";
import { useConnectionStore } from "@/store/useConnectionStore";
import { ConnectionPage } from "@/pages/connection";
import { WorkspacePage } from "@/pages/workspace";
import { Loader2 } from "lucide-react";
import { LspBinaryManager, LspUpdateNotification } from "@/components/lsp";

function App() {
  const { isConnected, loadConnections, isLoading } = useConnectionStore();

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
      {/* LSP binary management components */}
      <LspBinaryManager />
      <LspUpdateNotification />

      <div className="bg-background text-foreground h-screen w-screen overflow-hidden">
        {isConnected ? <WorkspacePage /> : <ConnectionPage />}
      </div>
    </ThemeProvider>
  );
}

export default App;
