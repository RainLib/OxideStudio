import { useConnectionStore } from "@/store/useConnectionStore";
import { LogOut, Slack } from "lucide-react";
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
              {/* Fixed-width icon area (matches ActivityBar width 50px) */}
              <div className="w-[50px] h-full flex items-center justify-center shrink-0">
                <Slack size={18} />
              </div>

              {/* Expandable content area */}
              {isDrawerOpen && (
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
            className="w-64 p-2 bg-background-elevated border-border text-foreground"
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
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
}
