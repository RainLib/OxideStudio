import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  Search,
  Database,
  Terminal,
  FilePlus,
  XCircle,
  Clock,
} from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const { tabs, setActiveTab, createTab, closeTab } = useTabStore();
  const { connections, selectConnection } = useConnectionStore();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-start justify-center pt-[15vh] p-4 bg-background/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="fixed inset-0" onClick={() => setOpen(false)} />
      <Command
        className="relative w-full max-w-2xl bg-popover border border-border rounded-xl shadow-2xl overflow-hidden animate-in slide-in-from-top-4 duration-300"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        <div className="flex items-center px-4 border-b border-border/50">
          <Search className="mr-3 h-4 w-4 text-muted-foreground shrink-0" />
          <Command.Input
            placeholder="Search tabs, connections, or commands..."
            className="flex h-12 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            ESC
          </kbd>
        </div>

        <Command.List className="max-h-[350px] overflow-y-auto overflow-x-hidden custom-scrollbar p-2">
          <Command.Empty className="py-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Search className="h-8 w-8 opacity-20" />
            No results found.
          </Command.Empty>

          <Command.Group
            heading={
              <span className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Active Tabs
              </span>
            }
          >
            {tabs.map((tab) => (
              <Command.Item
                key={tab.id}
                onSelect={() => {
                  setActiveTab(tab.id);
                  setOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground transition-all duration-150"
              >
                <Terminal className="h-4 w-4 text-primary/60" />
                <div className="flex-1 overflow-hidden">
                  <span className="text-sm font-medium truncate inline-block w-full">
                    {tab.title}
                  </span>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {tab.type === "query" ? "SQL Query" : "Table View"}
                  </p>
                </div>
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group
            heading={
              <span className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2">
                Actions
              </span>
            }
          >
            <Command.Item
              onSelect={() => {
                createTab("query", "New Query", "");
                setOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <FilePlus className="h-4 w-4" />
              <span className="text-sm">New Query Tab</span>
              <kbd className="ml-auto text-[10px] opacity-50 font-mono">⌘T</kbd>
            </Command.Item>
            <Command.Item
              onSelect={() => {
                if (tabs.length > 0) {
                  const lastTab = tabs[tabs.length - 1];
                  if (lastTab) closeTab(lastTab.id);
                }
                setOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
            >
              <XCircle className="h-4 w-4 text-destructive/60" />
              <span className="text-sm text-destructive/80">
                Close Active Tab
              </span>
              <kbd className="ml-auto text-[10px] opacity-50 font-mono">⌘W</kbd>
            </Command.Item>
          </Command.Group>

          <Command.Group
            heading={
              <span className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2">
                Connections
              </span>
            }
          >
            {connections.map((conn) => (
              <Command.Item
                key={conn.id}
                onSelect={() => {
                  selectConnection(conn.id);
                  setOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
              >
                <Database className="h-4 w-4 text-blue-500/60" />
                <span className="text-sm truncate">{conn.name}</span>
              </Command.Item>
            ))}
          </Command.Group>
        </Command.List>

        <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/5">
          <p className="text-[10px] text-muted-foreground/50 font-mono">
            Press <kbd className="bg-muted px-1 rounded">TAB</kbd> to navigate
          </p>
          <div className="flex gap-2">
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/30">
              <Clock size={10} /> Recents
            </span>
          </div>
        </div>
      </Command>
    </div>
  );
}
