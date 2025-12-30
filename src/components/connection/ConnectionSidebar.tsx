import { useConnectionStore } from "@/store/useConnectionStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { Button } from "@/components/ui/button";
import { Plus, Database, Monitor, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Settings } from "lucide-react";
import { SettingsDialog } from "@/components/settings/SettingsDialog";

export function ConnectionSidebar() {
  const [showSettings, setShowSettings] = useState(false);
  const {
    connections,
    isLoading,
    activeConnectionId,
    selectedConnection,
    selectConnection,
    createNewConnection,
  } = useConnectionStore();
  const { activeWorkspaceId, workspaceConnections } = useWorkspaceStore();
  const [filter, setFilter] = useState("");

  const filteredConnections = connections.filter((c) => {
    const matchesFilter =
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.host?.toLowerCase().includes(filter.toLowerCase());

    if (!matchesFilter) return false;

    if (activeWorkspaceId) {
      const workspaceConnIds = workspaceConnections[activeWorkspaceId] || [];
      return workspaceConnIds.includes(c.id);
    }

    return true;
  });

  return (
    <div className="w-[300px] border-r border-white/5 bg-[#18181b] flex flex-col h-full z-10">
      {/* Header & Actions */}
      <div className="p-4 pb-2 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
            Connections
          </h2>
          <Button
            onClick={() => {
              const newConn = createNewConnection();
              if (activeWorkspaceId) {
                const { addConnectionToWorkspace } =
                  useWorkspaceStore.getState();
                addConnectionToWorkspace(activeWorkspaceId, newConn.id);
              }
            }}
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <Plus size={16} strokeWidth={2.5} />
          </Button>
        </div>

        {/* Search */}
        <div className="relative group">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 transition-colors group-focus-within:text-foreground/70"
            size={14}
          />
          <input
            className="w-full bg-secondary/50 hover:bg-secondary/80 focus:bg-background text-foreground text-xs pl-9 pr-3 h-9 rounded-lg border border-transparent focus:border-border/60 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground/50"
            placeholder="Search..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
        {isLoading && (
          <div className="p-8 text-center text-xs text-muted-foreground/50 animate-pulse">
            Loading...
          </div>
        )}

        {!isLoading && filteredConnections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground/40 gap-2">
            <Search size={24} strokeWidth={1} />
            <p className="text-xs">No connections found</p>
          </div>
        )}

        {filteredConnections.map((conn) => (
          <div
            key={conn.id}
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg cursor-pointer group transition-all duration-200 border border-transparent",
              // Selected state
              selectedConnection?.id === conn.id
                ? "bg-secondary shadow-sm ring-1 ring-border/50"
                : "hover:bg-secondary/40",
              // Active (Connected) state
              activeConnectionId === conn.id && "bg-secondary/30"
            )}
            onClick={() => selectConnection(conn.id)}
          >
            {/* Status Indicator */}
            <div
              className={cn(
                "w-1 h-8 rounded-full transition-all duration-500",
                activeConnectionId === conn.id
                  ? "bg-green-500 scale-y-100 opacity-100"
                  : "bg-transparent scale-y-0 opacity-0 w-0"
              )}
            />

            {/* Icon Box */}
            <div
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-300",
                conn.driver === "postgres"
                  ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500/20"
                  : "bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:bg-orange-500/20",
                selectedConnection?.id === conn.id && "scale-105"
              )}
            >
              {conn.driver === "postgres" ? (
                <Database size={16} strokeWidth={2} />
              ) : (
                <Monitor size={16} strokeWidth={2} />
              )}
            </div>

            <div className="flex-1 overflow-hidden min-w-0">
              <div
                className={cn(
                  "font-medium text-sm truncate transition-colors",
                  selectedConnection?.id === conn.id
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground/90"
                )}
              >
                {conn.name}
              </div>
              <div className="text-[11px] text-muted-foreground/60 truncate transition-colors group-hover:text-muted-foreground/80 font-mono mt-0.5">
                {conn.host
                  ? `${conn.user}@${conn.host}:${conn.port}`
                  : "Local file"}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="h-8 border-t border-white/5 bg-[#18181b] flex items-center justify-between px-3 text-[10px] text-muted-foreground/60">
        <span className="font-mono opacity-50">v0.1.0</span>
        <button
          onClick={() => setShowSettings(true)}
          className="hover:text-foreground hover:bg-secondary/80 p-1.5 rounded-md transition-all"
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </div>
  );
}
