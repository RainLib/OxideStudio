import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Clipboard,
  Columns3,
  FileCode2,
  KeyRound,
  Link2,
  ListTree,
  RefreshCw,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "./ExplorerContextMenuHost";
import { constraintPresentation } from "@/features/database-explorer/model/constraintPresentation";
import {
  loadTableMetadata,
  type TableMetadataIdentity,
  type TableMetadataSnapshot,
} from "@/services/tableMetadataCache";
import { resolveMetadataConnectionScope } from "@/services/metadataConnectionScope";
import type { SchemaObjectInfo } from "@/services/tauri/types";
import {
  EXPLORER_MENU_CONTENT_CLASS,
  EXPLORER_MENU_ITEM_CLASS,
} from "./explorerStyles";
import {
  ExplorerDirectoryRow,
  type ExplorerDirectoryRowProps,
} from "./ExplorerDirectoryRow";
import { ExplorerTreeStateRow } from "./ExplorerTreeStateRow";
import { ExplorerVirtualList } from "./ExplorerVirtualList";

type MetadataGroup =
  "columns" | "indexes" | "foreignKeys" | "constraints" | "triggers";

interface TableObjectTreeProps {
  identity: TableMetadataIdentity;
  includeIndexes: boolean;
  includeConstraints: boolean;
  triggers?: readonly SchemaObjectInfo[];
  onReferenceSelect?: (target: { schema: string; table: string }) => void;
  onTriggerOpen?: (trigger: SchemaObjectInfo) => void;
}

function GroupRow(props: ExplorerDirectoryRowProps) {
  return (
    <ExplorerDirectoryRow
      {...props}
      className="pl-7 pr-2 text-[10px] text-[hsl(var(--wb-text-muted))]"
    />
  );
}

const menuContentClass = EXPLORER_MENU_CONTENT_CLASS;
const menuItemClass = EXPLORER_MENU_ITEM_CLASS;

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function columnDefinition(column: TableMetadataSnapshot["columns"][number]) {
  return [
    column.name,
    column.data_type,
    column.is_nullable ? null : "NOT NULL",
    column.default_value ? `DEFAULT ${column.default_value}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function TableObjectTree({
  identity,
  includeIndexes,
  includeConstraints,
  triggers = [],
  onReferenceSelect,
  onTriggerOpen,
}: TableObjectTreeProps) {
  const scopedIdentity = resolveMetadataConnectionScope(identity);
  const [metadata, setMetadata] = useState<TableMetadataSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
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
        const message =
          reason instanceof Error ? reason.message : String(reason);
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
      <ExplorerTreeStateRow
        state="error"
        className="pl-9 pr-2"
        title={error}
        onRetry={refresh}
        retryAriaLabel="Retry table metadata"
      >
        Metadata unavailable
      </ExplorerTreeStateRow>
    );
  }

  if (!metadata) {
    return (
      <ExplorerTreeStateRow state="loading" className="pl-9">
        Loading metadata
      </ExplorerTreeStateRow>
    );
  }

  const foreignKeys = metadata.constraints.filter(
    (constraint) => constraintPresentation(constraint).isForeignKey,
  );
  const constraints = metadata.constraints.filter(
    (constraint) => !constraintPresentation(constraint).isForeignKey,
  );

  const renderConstraintRow = (
    constraint: TableMetadataSnapshot["constraints"][number],
  ) => {
    const presentation = constraintPresentation(constraint);
    const nodeKey = `constraint:${constraint.name}`;
    return (
      <ExplorerSharedContextMenu
        key={`${constraint.constraint_type}:${constraint.name}`}
        nodeId={nodeKey}
      >
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            className={cn(
              "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[3px] pl-12 pr-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
              selectedNodeKey === nodeKey && "wb-tree-row-selected",
            )}
            title={presentation.title}
            onClick={() => setSelectedNodeKey(nodeKey)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setSelectedNodeKey(nodeKey);
            }}
          >
            <KeyRound
              size={9}
              className={cn(
                "shrink-0 text-amber-300/65",
                presentation.isForeignKey && "text-sky-300 opacity-90",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{constraint.name}</span>
            {presentation.isForeignKey &&
            constraint.referenced_table &&
            onReferenceSelect ? (
              <button
                type="button"
                className="max-w-[48%] truncate font-mono text-[9px] text-sky-300/80 hover:text-sky-200 focus:outline-none focus-visible:underline"
                title={`${presentation.title}. Open referenced relation.`}
                onClick={(event) => {
                  event.stopPropagation();
                  onReferenceSelect({
                    schema: constraint.referenced_schema || identity.schema,
                    table: constraint.referenced_table!,
                  });
                }}
              >
                {presentation.detail}
              </button>
            ) : (
              <span className="max-w-[48%] truncate font-mono text-[9px] opacity-65">
                {presentation.detail}
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className={menuContentClass}>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() => void copyText(constraint.name)}
          >
            <Clipboard className="mr-2 h-3.5 w-3.5" />
            Copy Name
          </ContextMenuItem>
          <ContextMenuItem
            className={menuItemClass}
            onClick={() => void copyText(presentation.detail)}
          >
            Copy Definition
          </ContextMenuItem>
          {presentation.isForeignKey &&
            constraint.referenced_table &&
            onReferenceSelect && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    onReferenceSelect({
                      schema: constraint.referenced_schema || identity.schema,
                      table: constraint.referenced_table!,
                    })
                  }
                >
                  <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
                  Open Referenced Table
                </ContextMenuItem>
              </>
            )}
        </ContextMenuContent>
      </ExplorerSharedContextMenu>
    );
  };

  return (
    <ExplorerContextMenuHost>
      <div
        className="group/tree-metadata pb-0.5"
        data-metadata-source={metadata.source}
      >
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
        onRefresh={refresh}
      />
      {expandedGroups.has("columns") && (
        <ExplorerVirtualList
          items={metadata.columns}
          getKey={(column) => column.name}
          renderItem={(column) => {
          const nodeKey = `column:${column.name}`;
          const qualifiedName = `${identity.schema}.${identity.table}.${column.name}`;
          return (
            <ExplorerSharedContextMenu key={nodeKey} nodeId={nodeKey}>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[3px] pl-12 pr-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
                    selectedNodeKey === nodeKey && "wb-tree-row-selected",
                  )}
                  title={`${column.name} · ${column.data_type}${column.is_nullable ? " · nullable" : " · not null"}${column.comment ? `\n${column.comment}` : ""}`}
                  onClick={() => setSelectedNodeKey(nodeKey)}
                >
                  {column.is_primary_key ? (
                    <KeyRound size={9} className="shrink-0 text-amber-400/90" />
                  ) : (
                    <span className="h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--wb-text-muted)/0.5)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[hsl(var(--wb-text-secondary))]">
                    {column.name}
                  </span>
                  {column.is_primary_key && (
                    <span className="text-[8px] font-semibold text-amber-300/80">
                      PK
                    </span>
                  )}
                  {!column.is_primary_key && column.is_unique && (
                    <span className="text-[8px] font-semibold text-emerald-300/75">
                      UQ
                    </span>
                  )}
                  <span className="max-w-[42%] truncate font-mono text-[9px] opacity-65">
                    {column.data_type}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className={menuContentClass}>
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() => void copyText(column.name)}
                >
                  <Clipboard className="mr-2 h-3.5 w-3.5" />
                  Copy Name
                </ContextMenuItem>
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() => void copyText(qualifiedName)}
                >
                  Copy Qualified Name
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() => void copyText(columnDefinition(column))}
                >
                  <FileCode2 className="mr-2 h-3.5 w-3.5" />
                  Copy Column Definition
                </ContextMenuItem>
                {column.comment && (
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() => void copyText(column.comment || "")}
                  >
                    Copy Comment
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ExplorerSharedContextMenu>
          );
          }}
        />
      )}

      {includeIndexes && (
        <>
          <GroupRow
            expanded={expandedGroups.has("indexes")}
            icon={<ListTree size={10} />}
            label="Indexes"
            count={metadata.indexes.length}
            onToggle={() => toggleGroup("indexes")}
            onRefresh={refresh}
          />
          {expandedGroups.has("indexes") && (
            <ExplorerVirtualList
              items={metadata.indexes}
              getKey={(index) => index.name}
              renderItem={(index) => {
              const nodeKey = `index:${index.name}`;
              return (
                <ExplorerSharedContextMenu key={nodeKey} nodeId={nodeKey}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[3px] pl-12 pr-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
                        selectedNodeKey === nodeKey && "wb-tree-row-selected",
                      )}
                      title={`${index.name} (${index.columns.join(", ")})${index.is_unique ? " · unique" : ""}${index.comment ? `\n${index.comment}` : ""}`}
                      onClick={() => setSelectedNodeKey(nodeKey)}
                    >
                      <KeyRound
                        size={9}
                        className={cn(
                          "shrink-0 text-amber-300/70",
                          index.is_unique && "text-emerald-300/90",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {index.name}
                      </span>
                      {index.is_unique && (
                        <span className="text-[8px] font-semibold text-emerald-300/75">
                          UQ
                        </span>
                      )}
                      <span className="max-w-[45%] truncate font-mono text-[9px] opacity-65">
                        {index.columns.join(", ")}
                      </span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className={menuContentClass}>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void copyText(index.name)}
                    >
                      <Clipboard className="mr-2 h-3.5 w-3.5" />
                      Copy Name
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void copyText(index.columns.join(", "))}
                    >
                      Copy Column List
                    </ContextMenuItem>
                    {index.definition && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() => void copyText(index.definition || "")}
                        >
                          <FileCode2 className="mr-2 h-3.5 w-3.5" />
                          Copy Definition
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ExplorerSharedContextMenu>
              );
              }}
            />
          )}
        </>
      )}

      {includeConstraints && (
        <>
          <GroupRow
            expanded={expandedGroups.has("foreignKeys")}
            icon={<Link2 size={10} />}
            label="Foreign Keys"
            count={foreignKeys.length}
            onToggle={() => toggleGroup("foreignKeys")}
            onRefresh={refresh}
          />
          {expandedGroups.has("foreignKeys") && (
            <ExplorerVirtualList
              items={foreignKeys}
              getKey={(constraint) =>
                `${constraint.constraint_type}:${constraint.name}`
              }
              renderItem={renderConstraintRow}
            />
          )}
          <GroupRow
            expanded={expandedGroups.has("constraints")}
            icon={<KeyRound size={10} />}
            label="Constraints"
            count={constraints.length}
            onToggle={() => toggleGroup("constraints")}
            onRefresh={refresh}
          />
          {expandedGroups.has("constraints") && (
            <ExplorerVirtualList
              items={constraints}
              getKey={(constraint) =>
                `${constraint.constraint_type}:${constraint.name}`
              }
              renderItem={renderConstraintRow}
            />
          )}
        </>
      )}

      {triggers.length > 0 && (
        <>
          <GroupRow
            expanded={expandedGroups.has("triggers")}
            icon={<Zap size={10} />}
            label="Triggers"
            count={triggers.length}
            onToggle={() => toggleGroup("triggers")}
            onRefresh={refresh}
          />
          {expandedGroups.has("triggers") && (
            <ExplorerVirtualList
              items={triggers}
              getKey={(trigger) => trigger.name}
              renderItem={(trigger) => {
              const nodeKey = `trigger:${trigger.name}`;
              const qualifiedName = identity.schema
                ? `${identity.schema}.${trigger.name}`
                : trigger.name;
              return (
                <ExplorerSharedContextMenu key={nodeKey} nodeId={nodeKey}>
                  <ContextMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[3px] pl-12 pr-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
                        selectedNodeKey === nodeKey && "wb-tree-row-selected",
                      )}
                      title={trigger.comment || `Trigger on ${identity.table}`}
                      onClick={() => setSelectedNodeKey(nodeKey)}
                      onDoubleClick={() => onTriggerOpen?.(trigger)}
                    >
                      <Zap size={9} className="shrink-0 text-orange-400/85" />
                      <span className="min-w-0 flex-1 truncate">
                        {trigger.name}
                      </span>
                      {trigger.comment?.trim() && (
                        <span className="max-w-[42%] truncate text-[9px] opacity-60">
                          {trigger.comment.trim()}
                        </span>
                      )}
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className={menuContentClass}>
                    {onTriggerOpen && (
                      <>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() => onTriggerOpen(trigger)}
                        >
                          <FileCode2 className="mr-2 h-3.5 w-3.5" />
                          View Source
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                      </>
                    )}
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void copyText(trigger.name)}
                    >
                      <Clipboard className="mr-2 h-3.5 w-3.5" />
                      Copy Name
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void copyText(qualifiedName)}
                    >
                      Copy Qualified Name
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ExplorerSharedContextMenu>
              );
              }}
            />
          )}
        </>
      )}
      </div>
    </ExplorerContextMenuHost>
  );
}
