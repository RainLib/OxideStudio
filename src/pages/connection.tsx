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
    <div className="flex flex-col h-screen w-full bg-background/95 text-foreground overflow-hidden">
      <AppBar title="OxideStudio" />
      <div className="flex flex-1 min-h-0 bg-[#09090b] relative">
        <WorkspaceSidebar />
        <ConnectionSidebar width={sidebarWidth} />

        {/* Resizer Divider */}
        <div
          className={cn(
            "w-px hover:w-1 bg-white/5 hover:bg-primary/50 cursor-col-resize transition-all z-20 absolute top-0 bottom-0"
          )}
          style={{ left: `${sidebarWidth + 70}px` }} // 70px is the width of WorkspaceSidebar
          onMouseDown={handleDragStart}
        />

        <div className="flex-1 min-w-0 bg-[#09090b] relative z-10">
          <ConnectionForm />
        </div>
      </div>
    </div>
  );
}
