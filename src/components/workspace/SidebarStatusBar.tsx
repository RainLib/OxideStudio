import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { Folder, LogOut } from "lucide-react";
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
  width?: number;
}

export function SidebarStatusBar({
  isDrawerOpen,
  width = 50,
}: SidebarStatusBarProps) {
  const { activeConnectionId, connections, disconnect, setActiveConnection } =
    useConnectionStore();
  const { activeProjectName } = useProjectStore();
  const [open, setOpen] = useState(false);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  return (
    <>
      <div
        style={{ width: `${width}px` }}
        className="h-full flex items-center shrink-0"
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div
              className={cn(
                "h-full flex-1 flex items-center gap-0 select-none overflow-hidden cursor-pointer transition-colors duration-300",
                "hover:bg-current/10"
              )}
            >
              <div className="flex h-full shrink-0 items-center gap-1 px-2">
                <Folder size={13} />
                <span className="text-[11px] font-medium">
                  {activeProjectName || "sqls"}
                </span>
              </div>

              {/* Expandable content area */}
              {isDrawerOpen && activeConnection && (
                <div className="flex-1 flex items-center gap-2 px-2 text-[10px] font-bold overflow-hidden">
                  {/* Connection Info */}
                  <div
                    className="flex items-center gap-1.5 min-w-0 flex-1"
                    title={activeConnection?.name || "No Connection"}
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        activeConnection
                          ? "bg-primary-foreground"
                          : "bg-red-900 animate-pulse"
                      }`}
                    />
                    <span className="truncate">
                      {activeConnection?.name || "No Connection"}
                    </span>
                  </div>

                  {activeConnection && (
                    <>
                      <div className="h-3 w-px bg-primary-foreground/20 shrink-0" />
                      <div
                        className="flex items-center gap-1 opacity-80 shrink-0"
                        title={`Driver: ${activeConnection.driver}`}
                      >
                        <span className="uppercase tracking-wider text-[9px]">
                          {activeConnection?.driver || "SQL"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </PopoverTrigger>
          <PopoverContent
            className="w-64 p-2 border-border text-foreground"
            align="start"
            side="top"
          >
            <div className="flex flex-col gap-1">
              {/* Connection List */}
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
                Connections
              </div>
              {connections.map((conn) => (
                <Button
                  key={conn.id}
                  variant="ghost"
                  className={cn(
                    "w-full justify-start text-xs h-8 px-2",
                    conn.id === activeConnectionId
                      ? "bg-background-tertiary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-background-tertiary/50"
                  )}
                  onClick={() => {
                    void setActiveConnection(conn.id);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <div
                      className={`w-1.5 h-1.5 rounded-full ${
                        conn.id === activeConnectionId
                          ? "bg-primary"
                          : "bg-muted-foreground"
                      }`}
                    />
                    <span className="truncate flex-1 text-left">
                      {conn.name}
                    </span>
                    <span className="text-[9px] uppercase opacity-60">
                      {conn.driver}
                    </span>
                  </div>
                </Button>
              ))}

              <div className="h-px bg-border my-1" />

              {/* Actions */}
              <Button
                variant="ghost"
                className="w-full justify-start text-xs h-8 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={() => {
                  void disconnect();
                  setOpen(false);
                }}
              >
                <LogOut size={14} className="mr-2" />
                Disconnect
              </Button>
              {connections.length === 0 && (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                  Add a data source from Settings.
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
