import { useConnectionStore } from "@/store/useConnectionStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { Button } from "@/components/ui/button";
import { Plus, Database, Monitor, Search, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { ConnectionConfig } from "@/store/useConnectionStore";

interface ConnectionSidebarProps {
  width?: number;
}

export function ConnectionSidebar({ width = 300 }: ConnectionSidebarProps) {
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Get all unique tags from all connections
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    connections.forEach((c: ConnectionConfig) => {
      c.tags?.forEach((t: string) => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [connections]);

  const filteredConnections = connections.filter((c: ConnectionConfig) => {
    const matchesFilter =
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.host?.toLowerCase().includes(filter.toLowerCase());

    if (!matchesFilter) return false;

    // Tag filtering (OR logic: if any selected tag matches)
    if (selectedTags.length > 0) {
      const hasMatchingTag = selectedTags.some((tag: string) =>
        c.tags?.includes(tag)
      );
      if (!hasMatchingTag) return false;
    }

    if (activeWorkspaceId) {
      const workspaceConnIds = workspaceConnections[activeWorkspaceId] || [];
      return workspaceConnIds.includes(c.id);
    }

    return true;
  });

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  return (
    <div
      style={{ width: `${width}px` }}
      className="border-r border-white/5 bg-[#18181b] flex flex-col h-full z-10"
    >
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

        {/* Tag Filters */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-1">
            {allTags.map((tag: string) => {
              const isActive = selectedTags.includes(tag);
              return (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full border transition-all flex items-center gap-1",
                    isActive
                      ? "bg-primary/20 border-primary/40 text-primary shadow-sm"
                      : "bg-secondary/30 border-border/40 text-muted-foreground/60 hover:border-border/80 hover:text-muted-foreground"
                  )}
                >
                  {isActive && <Filter size={8} />}
                  {tag}
                </button>
              );
            })}
            {selectedTags.length > 0 && (
              <button
                onClick={() => setSelectedTags([])}
                className="text-[10px] px-2 py-0.5 text-muted-foreground/40 hover:text-destructive transition-colors flex items-center gap-1"
              >
                <X size={8} /> Clear
              </button>
            )}
          </div>
        )}
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

        {filteredConnections.map((conn: ConnectionConfig) => (
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
              <div className="flex items-center gap-2 mt-0.5">
                <div className="text-[11px] text-muted-foreground/60 truncate transition-colors group-hover:text-muted-foreground/80 font-mono">
                  {conn.host
                    ? `${conn.user}@${conn.host}:${conn.port}`
                    : "Local file"}
                </div>

                {/* Inline Tags on Hover */}
                <div className="hidden group-hover:flex items-center gap-1 overflow-hidden animate-in fade-in slide-in-from-left-1 duration-200">
                  {conn.tags?.slice(0, 2).map((tag: string) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[9px] px-1 py-0 leading-none h-3.5 border-primary/20 text-primary/70 font-normal whitespace-nowrap"
                    >
                      {tag}
                    </Badge>
                  ))}
                  {(conn.tags?.length || 0) > 2 && (
                    <span className="text-[9px] text-muted-foreground/40">
                      +{conn.tags!.length - 2}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
