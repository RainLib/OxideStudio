import { useConnectionStore } from "@/store/useConnectionStore";
import { Database, LogOut, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";

interface SidebarStatusBarProps {
  isDrawerOpen: boolean;
}

export function SidebarStatusBar({ isDrawerOpen }: SidebarStatusBarProps) {
  const { activeConnectionId, connections, disconnect, setActiveConnection } =
    useConnectionStore();
  const [open, setOpen] = useState(false);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "h-[28px] px-2 bg-[#e67e22] flex items-center gap-2 text-[11px] text-[#1a1a1a] font-bold select-none shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.1)] z-50 overflow-hidden cursor-pointer hover:bg-[#d67319] transition-colors",
            isDrawerOpen ? "w-auto" : "w-[50px]"
          )}
        >
          {isDrawerOpen ? (
            <>
              {/* Connection Info */}
              <div
                className="flex items-center gap-1.5 min-w-0 flex-1"
                title={activeConnection?.name || "No Connection"}
              >
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    activeConnection
                      ? "bg-[#1a1a1a]"
                      : "bg-red-900 animate-pulse"
                  }`}
                />
                <span className="truncate">
                  {activeConnection?.name || "No Connection"}
                </span>
              </div>

              {activeConnection && (
                <>
                  <div className="h-3 w-px bg-[#1a1a1a]/20 shrink-0" />
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

              <ChevronDown size={12} className="ml-auto opacity-70" />
            </>
          ) : (
            <div className="flex items-center justify-center w-full">
              <div
                className={`w-2 h-2 rounded-full ${
                  activeConnection ? "bg-[#1a1a1a]" : "bg-red-900 animate-pulse"
                }`}
              />
            </div>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-2 bg-[#2a2a2a] border-[#3a3a3a] text-gray-200"
        align="start"
        side="top"
      >
        <div className="flex flex-col gap-1">
          {/* Connection List */}
          <div className="text-[10px] uppercase tracking-wider text-gray-500 px-2 py-1">
            Connections
          </div>
          {connections.map((conn) => (
            <Button
              key={conn.id}
              variant="ghost"
              className={cn(
                "w-full justify-start text-xs h-8 px-2",
                conn.id === activeConnectionId
                  ? "bg-[#3a3a3a] text-gray-100"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#353535]"
              )}
              onClick={() => {
                setActiveConnection(conn.id);
                setOpen(false);
              }}
            >
              <div className="flex items-center gap-2 w-full">
                <div
                  className={`w-1.5 h-1.5 rounded-full ${
                    conn.id === activeConnectionId
                      ? "bg-[#f39c12]"
                      : "bg-gray-600"
                  }`}
                />
                <span className="truncate flex-1 text-left">{conn.name}</span>
                <span className="text-[9px] uppercase opacity-60">
                  {conn.driver}
                </span>
              </div>
            </Button>
          ))}

          <div className="h-px bg-[#3a3a3a] my-1" />

          {/* Actions */}
          <Button
            variant="ghost"
            className="w-full justify-start text-xs h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
          >
            <LogOut size={14} className="mr-2" />
            Disconnect
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
