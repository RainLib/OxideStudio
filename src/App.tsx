import { useEffect } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { ConnectionPage } from "@/pages/connection";
import { Workspace } from "@/components/workspace/Workspace";
import { Loader2 } from "lucide-react";

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
      )
  }

  return (
    <div className="bg-background text-foreground h-screen w-screen overflow-hidden">
        {isConnected ? <Workspace /> : <ConnectionPage />}
    </div>
  );
}

export default App;
