import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { Database, Circle, Settings, Download } from "lucide-react";

export function StatusBar() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { currentSchema } = useSchemaStore();

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <div className="h-[28px] px-3 bg-[#e67e22] flex items-center gap-3 text-[11px] text-[#1a1a1a] font-bold select-none shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.1)] z-50">
      {/* Connection Info */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            activeConnection ? "bg-[#1a1a1a]" : "bg-red-900 animate-pulse"
          }`}
        />
        <span className="truncate max-w-[150px]">
          {activeConnection?.name || "No Connection"}
        </span>
      </div>

      {/* Divider */}
      <div className="h-3 w-[1px] bg-[#1a1a1a]/20" />

      {/* Driver Badge */}
      <div className="flex items-center gap-1.5 opacity-80">
        <Database size={12} strokeWidth={2.5} />
        <span className="uppercase tracking-wider text-[9px]">
          {activeConnection?.driver || "SQL"}
        </span>
      </div>

      {/* Schema Info */}
      {currentSchema && (
        <>
          <div className="h-3 w-[1px] bg-[#1a1a1a]/20" />
          <span className="opacity-90">{currentSchema}</span>
        </>
      )}

      {/* Right Actions */}
      <div className="ml-auto flex items-center gap-3 opacity-70">
        <div className="flex items-center gap-1 cursor-pointer hover:opacity-100 transition-opacity">
          <Download size={12} />
          <span className="text-[10px]">Download</span>
        </div>
        <div className="cursor-pointer hover:opacity-100 transition-opacity">
          <Settings size={12} />
        </div>
      </div>
    </div>
  );
}
