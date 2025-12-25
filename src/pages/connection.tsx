import { useEffect } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { ConnectionSidebar } from "@/components/connection/ConnectionSidebar";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
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
    <div className="flex h-screen w-full bg-[#131313] text-gray-200 overflow-hidden">
      <ConnectionSidebar />
      <ConnectionForm />
    </div>
  );
}
