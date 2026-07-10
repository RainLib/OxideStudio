import { useState, useEffect } from "react";
import { useConnectionStore } from "@/store/useConnectionStore";
import { ConnectionSidebar } from "@/components/connection/ConnectionSidebar";
import { WorkspaceSidebar } from "@/components/connection/WorkspaceSidebar";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
import { AppBar } from "@/components/AppBar";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConnectionPage() {
  const { loadConnections, isLoading } = useConnectionStore();
  const [sidebarWidth, setSidebarWidth] = useState(300);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleDragStart = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(200, startWidth + deltaX);
      setSidebarWidth(Math.min(newWidth, 600));
    };

    const handleDragEnd = () => {
      document.removeEventListener("mousemove", handleDrag);
      document.removeEventListener("mouseup", handleDragEnd);
    };

    document.addEventListener("mousemove", handleDrag);
    document.addEventListener("mouseup", handleDragEnd);
  };

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="workbench-shell flex flex-col">
      <AppBar title="OxideStudio" />
      <div className="flex flex-1 min-h-0 bg-[hsl(var(--wb-editor))] relative">
        <WorkspaceSidebar />
        <ConnectionSidebar width={sidebarWidth} />

        {/* Resizer Divider */}
        <div
          className={cn(
            "wb-resizer-x z-20 absolute top-0 bottom-0"
          )}
          style={{ left: `${sidebarWidth + 40}px` }}
          onMouseDown={handleDragStart}
        />

        <div className="flex-1 min-w-0 bg-[hsl(var(--wb-editor))] relative z-10">
          <ConnectionForm />
        </div>
      </div>
    </div>
  );
}
