import { useConnectionStore } from "@/store/useConnectionStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { Button } from "@/components/ui/button";
import { Plus, Database, Monitor, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function ConnectionSidebar() {
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
    <div className="w-[280px] border-r border-[#333] bg-[#1a1a1a] flex flex-col h-full">
      {/* Search / Filter Header */}
      <div className="p-3 border-b border-[#333]">
        <div className="relative mb-3">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
            size={14}
          />
          <input
            className="w-full bg-[#252525] text-gray-200 text-xs pl-8 pr-2 h-8 rounded border border-transparent focus:border-[#f39c12] focus:outline-none transition-colors"
            placeholder="Search connections..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <Button
          onClick={() => {
            const newConn = createNewConnection();
            if (activeWorkspaceId) {
              const { addConnectionToWorkspace } = useWorkspaceStore.getState();
              addConnectionToWorkspace(activeWorkspaceId, newConn.id);
            }
          }}
          className="w-full gap-2 bg-[#f39c12] hover:bg-[#d35400] text-white h-8 text-xs font-semibold shadow-md"
          size="sm"
        >
          <Plus size={14} strokeWidth={2.5} /> New Connection
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
        <div className="text-[10px] uppercase font-bold text-gray-500 px-2 py-2 tracking-wider">
          Saved Connections
        </div>

        {isLoading && (
          <div className="p-4 text-center text-xs text-gray-500">
            Loading connections...
          </div>
        )}

        {filteredConnections.map((conn) => (
          <div
            key={conn.id}
            className={cn(
              "flex items-center gap-3 p-3 rounded-md cursor-pointer group transition-all border border-transparent",
              // Selected state
              selectedConnection?.id === conn.id
                ? "bg-[#2c2c2c] border-[#f39c12]/50 shadow-sm" // Subtle orange border for selected
                : "hover:bg-[#252525] hover:border-[#333]",
              // Active (Connected) state
              activeConnectionId === conn.id &&
                "border-l-4 border-l-green-500 pl-2 bg-[#252525]"
            )}
            onClick={() => selectConnection(conn.id)}
          >
            {/* Icon Box */}
            <div
              className={cn(
                "w-8 h-8 rounded flex items-center justify-center shrink-0 transition-colors",
                conn.driver === "postgres"
                  ? "bg-blue-500/10 text-blue-500"
                  : "bg-orange-500/10 text-orange-500",
                selectedConnection?.id === conn.id && "bg-[#1a1a1a]"
              )}
            >
              {conn.driver === "postgres" ? (
                <Database size={16} />
              ) : (
                <Monitor size={16} />
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              <div
                className={cn(
                  "font-medium text-sm truncate",
                  selectedConnection?.id === conn.id
                    ? "text-gray-100"
                    : "text-gray-400 group-hover:text-gray-200"
                )}
              >
                {conn.name}
              </div>
              <div className="text-[11px] text-gray-600 truncate group-hover:text-gray-500">
                {conn.host
                  ? `${conn.user}@${conn.host}:${conn.port}`
                  : "Local file"}
              </div>
            </div>
          </div>
        ))}

        {filteredConnections.length === 0 && !isLoading && (
          <div className="text-center text-xs text-gray-600 italic mt-8">
            No connections found
          </div>
        )}
      </div>

      <div className="p-3 border-t border-[#333] bg-[#161616] text-[10px] text-center text-gray-600">
        Oxide Studio v0.1.0
      </div>
    </div>
  );
}
