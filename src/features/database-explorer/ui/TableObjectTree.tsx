import { type ReactNode, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Columns3,
  KeyRound,
  ListTree,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { constraintPresentation } from "@/features/database-explorer/model/constraintPresentation";
import {
  loadTableMetadata,
  type TableMetadataIdentity,
  type TableMetadataSnapshot,
} from "@/services/tableMetadataCache";
import { resolveMetadataConnectionScope } from "@/services/metadataConnectionScope";

type MetadataGroup = "columns" | "indexes" | "constraints";

interface TableObjectTreeProps {
  identity: TableMetadataIdentity;
  includeIndexes: boolean;
  includeConstraints: boolean;
  onReferenceSelect?: (target: { schema: string; table: string }) => void;
}

function GroupRow({
  expanded,
  icon,
  label,
  count,
  onToggle,
}: {
  expanded: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex h-5 w-full min-w-0 items-center gap-1.5 rounded-[3px] pl-7 pr-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      <span className="opacity-75">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="tabular-nums opacity-65">{count}</span>
    </button>
  );
}

export function TableObjectTree({
  identity,
  includeIndexes,
  includeConstraints,
  onReferenceSelect,
}: TableObjectTreeProps) {
  const scopedIdentity = resolveMetadataConnectionScope(identity);
  const [metadata, setMetadata] = useState<TableMetadataSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<MetadataGroup>>(
    () => new Set(["columns"]),
  );

  useEffect(() => {
    let active = true;
    setMetadata(null);
    setError(null);
    setRefreshWarning(null);
    setIsRefreshing(refreshVersion > 0);
    void loadTableMetadata({
      ...scopedIdentity,
      includeIndexes,
      includeConstraints,
      force: refreshVersion > 0,
    })
      .then((snapshot) => {
        if (active) {
          setMetadata(snapshot);
          setIsRefreshing(false);
        }
      })
      .catch(async (reason: unknown) => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        // A force refresh must never make an already cached object tree disappear.
        // Reload without force so a complete persisted snapshot remains browseable
        // while clearly communicating that the remote refresh did not succeed.
        if (refreshVersion > 0) {
          try {
            const cached = await loadTableMetadata({
              ...scopedIdentity,
              includeIndexes,
              includeConstraints,
            });
            if (!active) return;
            setMetadata(cached);
            setRefreshWarning(message);
            setIsRefreshing(false);
            return;
          } catch {
            // No complete cached snapshot is available; use the actionable
            // error state below instead of presenting incomplete metadata.
          }
        }
        setError(message);
        setIsRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [
    identity.connectionId,
    identity.databaseName,
    identity.driver,
    identity.projectId,
    identity.schema,
    identity.table,
    scopedIdentity.connectionDatabaseName,
    scopedIdentity.driverPackageVersion,
    includeConstraints,
    includeIndexes,
    refreshVersion,
  ]);

  const refresh = () => {
    if (isRefreshing) return;
    setRefreshVersion((version) => version + 1);
  };

  const toggleGroup = (group: MetadataGroup) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (error) {
    return (
      <div
        className="flex h-5 items-center gap-1.5 pl-9 pr-2 text-[10px] text-red-400"
        title={error}
      >
        <CircleAlert size={10} />
        <span className="truncate">Metadata unavailable</span>
        <button
          type="button"
          className="ml-auto inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-red-300/80 hover:bg-red-500/15 hover:text-red-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
          aria-label="Retry table metadata"
          title="Retry metadata refresh"
          onClick={refresh}
        >
          <RefreshCw size={10} />
        </button>
      </div>
    );
  }

  if (!metadata) {
    return (
      <div className="flex h-5 items-center gap-1.5 pl-9 text-[10px] text-[hsl(var(--wb-text-muted))]">
        <RefreshCw size={10} className="animate-spin" />
        <span>Loading metadata</span>
      </div>
    );
  }

  return (
    <div className="group/tree-metadata pb-0.5" data-metadata-source={metadata.source}>
      <div className="flex h-4 items-center justify-end px-2">
        {refreshWarning && (
          <span
            className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
            title={`Refresh failed; showing cached metadata. ${refreshWarning}`}
            aria-label="Showing cached metadata after refresh failure"
          />
        )}
        <span
          className="text-[9px] text-[hsl(var(--wb-text-muted))] opacity-0 transition-opacity group-hover/tree-metadata:opacity-100 focus-within:opacity-100"
          title={
            refreshWarning
              ? `Refresh failed; showing cached metadata. ${refreshWarning}`
              : metadata.source === "cache"
              ? "Showing cached metadata. Refresh to query the data source again."
              : "Metadata was loaded from the data source."
          }
        >
          {metadata.source === "cache" ? "cached" : "live"}
        </span>
        <button
          type="button"
          className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] text-[hsl(var(--wb-text-muted))] opacity-0 transition-opacity hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus:outline-none focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] group-hover/tree-metadata:opacity-100"
          aria-label="Refresh table metadata"
          title="Refresh table metadata"
          onClick={refresh}
          disabled={isRefreshing}
        >
          <RefreshCw size={10} className={cn(isRefreshing && "animate-spin")} />
        </button>
      </div>
      <GroupRow
        expanded={expandedGroups.has("columns")}
        icon={<Columns3 size={10} />}
        label="Columns"
        count={metadata.columns.length}
        onToggle={() => toggleGroup("columns")}
      />
      {expandedGroups.has("columns") &&
        metadata.columns.map((column) => (
          <div
            key={column.name}
            className="flex h-5 min-w-0 items-center gap-1.5 pl-12 pr-2 text-[10px] text-[hsl(var(--wb-text-muted))]"
            title={`${column.name} · ${column.data_type}${column.is_nullable ? " · nullable" : " · not null"}`}
          >
            {column.is_primary_key ? (
              <KeyRound size={9} className="shrink-0 text-amber-400/90" />
            ) : (
              <span className="h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--wb-text-muted)/0.5)]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text-secondary))]">
              {column.name}
            </span>
            <span className="max-w-[42%] truncate font-mono text-[9px] opacity-65">
              {column.data_type}
            </span>
          </div>
        ))}

      {includeIndexes && (
        <>
          <GroupRow
            expanded={expandedGroups.has("indexes")}
            icon={<ListTree size={10} />}
            label="Indexes"
            count={metadata.indexes.length}
            onToggle={() => toggleGroup("indexes")}
          />
          {expandedGroups.has("indexes") &&
            metadata.indexes.map((index) => (
              <div
                key={index.name}
                className="flex h-5 min-w-0 items-center gap-1.5 pl-12 pr-2 text-[10px] text-[hsl(var(--wb-text-muted))]"
                title={`${index.name} (${index.columns.join(", ")})${index.is_unique ? " · unique" : ""}`}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-sm border border-[hsl(var(--wb-border))]",
                    index.is_unique && "border-emerald-400/70",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{index.name}</span>
                <span className="max-w-[45%] truncate font-mono text-[9px] opacity-65">
                  {index.columns.join(", ")}
                </span>
              </div>
            ))}
        </>
      )}

      {includeConstraints && (
        <>
          <GroupRow
            expanded={expandedGroups.has("constraints")}
            icon={<KeyRound size={10} />}
            label="Constraints"
            count={metadata.constraints.length}
            onToggle={() => toggleGroup("constraints")}
          />
          {expandedGroups.has("constraints") &&
            metadata.constraints.map((constraint) => {
              const presentation = constraintPresentation(constraint);
              return (
                <div
                  key={`${constraint.constraint_type}:${constraint.name}`}
                  className="flex h-5 min-w-0 items-center gap-1.5 pl-12 pr-2 text-[10px] text-[hsl(var(--wb-text-muted))]"
                  title={presentation.title}
                >
                  <KeyRound
                    size={9}
                    className={cn(
                      "shrink-0 opacity-60",
                      presentation.isForeignKey && "text-sky-300 opacity-90",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {constraint.name}
                  </span>
                  {presentation.isForeignKey &&
                  constraint.referenced_table &&
                  onReferenceSelect ? (
                    <button
                      type="button"
                      className="max-w-[48%] truncate font-mono text-[9px] text-sky-300/80 hover:text-sky-200 focus:outline-none focus-visible:underline"
                      title={`${presentation.title}. Open referenced relation.`}
                      onClick={() =>
                        onReferenceSelect({
                          schema: constraint.referenced_schema || identity.schema,
                          table: constraint.referenced_table!,
                        })
                      }
                    >
                      {presentation.detail}
                    </button>
                  ) : (
                    <span className="max-w-[48%] truncate font-mono text-[9px] opacity-65">
                      {presentation.detail}
                    </span>
                  )}
                </div>
              );
            })}
        </>
      )}
    </div>
  );
}
