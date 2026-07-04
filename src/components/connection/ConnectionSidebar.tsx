import {
  useConnectionStore,
  ConnectionConfig,
} from "@/store/useConnectionStore";
import { useWorkspaceStore } from "@/store/useWorkspaceStore";
import { Button } from "@/components/ui/button";
import { Plus, Search, X, Filter } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useMemo } from "react";
import {
  defaultConnectionAccentClassName,
  defaultConnectionIcon,
} from "@/lib/databaseDialect";

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
    connect,
  } = useConnectionStore();
  const { activeWorkspaceId, workspaceConnections } = useWorkspaceStore();
  const [filter, setFilter] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showTagFilters, setShowTagFilters] = useState(false);

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

  const renderConnectionIcon = (conn: ConnectionConfig) => {
    if (conn.icon?.startsWith("data:image")) {
      return (
        <img src={conn.icon} alt="icon" className="w-6 h-6 object-contain" />
      );
    }

    // Check if it's a valid Lucide icon
    const iconName = conn.icon;
    if (iconName) {
      const IconComponent = (LucideIcons as any)[iconName];
      if (IconComponent) {
        return <IconComponent size={22} strokeWidth={1.5} />;
      }

      // Render as text
      return (
        <span
          style={{ fontSize: 16 }}
          className="font-black font-mono tracking-tighter leading-none truncate dark:text-inherit text-inherit"
        >
          {iconName.slice(0, 3).toUpperCase()}
        </span>
      );
    }

    // Default Fallback
    const DefaultIcon =
      (LucideIcons as any)[defaultConnectionIcon(conn.driver)] ||
      LucideIcons.Database;
    return <DefaultIcon size={22} strokeWidth={1.5} />;
  };

  return (
    <div
      style={{ width: `${width}px` }}
      className="border-r border-white/5 bg-[#18181b] flex flex-col h-full z-10"
    >
      {/* Header & Actions */}
      <div className="p-4 pb-2 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground/90">
            Connections
          </h2>
          <div className="flex items-center gap-1">
            {allTags.length > 0 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowTagFilters(!showTagFilters)}
                className={cn(
                  "h-7 w-7 rounded-lg transition-colors",
                  showTagFilters || selectedTags.length > 0
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
                title="Filter by tags"
              >
                <Filter size={14} />
              </Button>
            )}
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

        {/* Tag Filters (Collapsible) */}
        {allTags.length > 0 && showTagFilters && (
          <div className="flex flex-wrap gap-1.5 pb-1 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
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
            onDoubleClick={() => {
              void connect(conn);
            }}
          >
            {/* Status Indicator */}
            <div
              className={cn(
                "w-1 h-10 rounded-full transition-all duration-500",
                activeConnectionId === conn.id
                  ? "bg-green-500 scale-y-100 opacity-100"
                  : "bg-transparent scale-y-0 opacity-0 w-0"
              )}
            />

            {/* Icon Box */}
            <div
              className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-300 shadow-sm",
                !conn.icon &&
                  !conn.color &&
                  defaultConnectionAccentClassName(conn.driver),
                selectedConnection?.id === conn.id && "scale-105 shadow-md"
              )}
              style={{
                backgroundColor: conn.color ? `${conn.color}20` : undefined,
                color: conn.color || undefined,
              }}
            >
              {renderConnectionIcon(conn)}
            </div>

            <div className="flex-1 overflow-hidden min-w-0 flex flex-col justify-center gap-2">
              <div
                className={cn(
                  "font-semibold text-sm truncate transition-colors leading-tight",
                  selectedConnection?.id === conn.id
                    ? "text-foreground"
                    : "text-muted-foreground group-hover:text-foreground/90"
                )}
              >
                {conn.name}
              </div>

              {/* Tags Display - Optimized */}
              {conn.tags && conn.tags.length > 0 ? (
                <div className="flex items-center gap-1.5 overflow-hidden flex-wrap">
                  {conn.tags.slice(0, 3).map((tag: string) => (
                    <span
                      key={tag}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-md leading-none whitespace-nowrap font-medium transition-all",
                        "bg-white/5 text-muted-foreground/90 border border-white/5 group-hover:border-white/10",
                        selectedConnection?.id === conn.id &&
                          "bg-primary/10 text-primary border-primary/20"
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                  {conn.tags.length > 3 && (
                    <span className="text-[10px] text-muted-foreground/40 leading-none">
                      +{conn.tags.length - 3}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
