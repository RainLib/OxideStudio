import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { Database, Settings } from "lucide-react";

export function SidebarStatusBar() {
  const { activeConnectionId, connections } = useConnectionStore();

  // Note: Schema info is usually context-dependent (one connection can have many schemas).
  // Beekeeper puts schema in the sidebar tree, not necessarily fixed in footer unless filtered.
  // We'll keep it simple: Name + Driver.

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="h-[28px] px-2 bg-[#e67e22] flex items-center gap-2 text-[11px] text-[#1a1a1a] font-bold select-none shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.1)] z-50 overflow-hidden w-full">
      {/* Connection Info */}
      <div
        className="flex items-center gap-1.5 min-w-0 flex-1"
        title={activeConnection?.name || "No Connection"}
      >
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${
            activeConnection ? "bg-[#1a1a1a]" : "bg-red-900 animate-pulse"
          }`}
        />
        <span className="truncate">
          {activeConnection?.name || "No Connection"}
        </span>
      </div>

      {activeConnection && (
        <>
          <div className="h-3 w-[1px] bg-[#1a1a1a]/20 shrink-0" />
          <div
            className="flex items-center gap-1 opacity-80 shrink-0"
            title={`Driver: ${activeConnection.driver}`}
          >
            <Database size={12} strokeWidth={2.5} />
            <span className="uppercase tracking-wider text-[9px]">
              {activeConnection?.driver || "SQL"}
            </span>
          </div>
        </>
      )}

      {/* Settings - Always visible if space allows, but can be pushed out if needed?
           We use shrink-0 so it stays. Name truncates. */}
      <div className="flex items-center gap-1 opacity-70 shrink-0 hover:opacity-100 cursor-pointer">
        <Settings size={12} />
      </div>
    </div>
  );
}
