import { useEffect } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { ConnectionSidebar } from "@/components/connection/ConnectionSidebar";
import { WorkspaceSidebar } from "@/components/connection/WorkspaceSidebar";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
import { AppBar } from "@/components/AppBar";
import { Loader2 } from "lucide-react";

export function ConnectionPage() {
  const { loadConnections, isLoading } = useConnectionStore();

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background/95 text-foreground overflow-hidden">
      <AppBar title="OxideStudio" />
      <div className="flex flex-1 min-h-0 bg-background">
        <WorkspaceSidebar />
        <ConnectionSidebar />
        <div className="flex-1 min-w-0 bg-background relative z-10">
          <ConnectionForm />
        </div>
      </div>
    </div>
  );
}
