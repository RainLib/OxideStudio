import { useConnectionStore } from "@/store/useConnectionStore";
import { SchemaSidebar } from "./SchemaSidebar";
import { QueryEditor } from "./QueryEditor";
import { DataGrid } from "./DataGrid";
import { TabBar } from "./TabBar";
import { useTabStore } from "@/store/useTabStore";
import { useEffect } from "react";

export function Workspace() {
  const { isConnected } = useConnectionStore();
  const { tabs, createTab } = useTabStore();

  useEffect(() => {
      // Create an initial tab if none exist
      if (tabs.length === 0) {
          createTab();
      }
  }, [tabs.length, createTab]);

  if (!isConnected) {
     return <div className="h-full flex items-center justify-center text-muted-foreground">Not connected</div>
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
        <SchemaSidebar />
        <div className="flex-1 flex flex-col bg-background min-w-0">
            {/* Tab Bar */}
            <TabBar />

            {/* Split View */}
            <div className="flex-1 flex flex-col min-h-0">
                <div className="h-1/3 border-b border-border">
                    <QueryEditor />
                </div>

                <div className="flex-1 min-h-0 bg-muted/5">
                    <DataGrid />
                </div>
            </div>
        </div>
    </div>
  );
}
