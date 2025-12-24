import { useConnectionStore } from "@/store/useConnectionStore";
import { Button } from "@/components/ui/button";
import { Plus, Database, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConnectionSidebar() {
  const { connections, isLoading, activeConnectionId, selectedConnection, selectConnection, createNewConnection } = useConnectionStore();

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-4 border-b">
        <Button
          onClick={createNewConnection}
          className="w-full gap-2" variant="outline"
        >
          <Plus size={16} /> New Connection
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
         {isLoading && <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>}
         {connections.map((conn) => (
           <div
              key={conn.id}
              className={cn(
                  "flex items-center gap-3 p-3 rounded-md hover:bg-accent cursor-pointer group transition-colors",
                  selectedConnection?.id === conn.id && "bg-accent/80 text-accent-foreground",
                  activeConnectionId === conn.id && "ring-1 ring-primary"
              )}
              onClick={() => selectConnection(conn.id)}
           >
              {conn.driver === 'postgres' ? <Database size={18} className="text-blue-500" /> : <Monitor size={18} className="text-orange-500" />}
              <div className="flex-1 overflow-hidden">
                  <div className="font-medium truncate">{conn.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{conn.host ? `${conn.host}:${conn.port}` : "Local file"}</div>
              </div>
           </div>
         ))}
      </div>
      <div className="p-2 border-t text-xs text-center text-muted-foreground">
          Oxide Studio
      </div>
    </div>
  );
}
