import { useEffect } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { ConnectionSidebar } from "@/components/connection/ConnectionSidebar";
import { WorkspaceSidebar } from "@/components/connection/WorkspaceSidebar";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
import { AppBar } from "@/components/AppBar";
import { Loader2 } from "lucide-react";
import { containerVariants } from "@/styles/variants";

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
    <div className={containerVariants({ layout: "connection" })}>
      <AppBar title="OxideStudio" />
      <div
        className={containerVariants({ direction: "row", layout: "content" })}
      >
        <WorkspaceSidebar />
        <ConnectionSidebar />
        <ConnectionForm />
      </div>
    </div>
  );
}
