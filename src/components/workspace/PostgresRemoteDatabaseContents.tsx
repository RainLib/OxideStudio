import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightLeft,
  Braces,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock3,
  GitCompareArrows,
  Link2,
  ListOrdered,
  Network,
  Package,
  RefreshCw,
  SquareFunction,
  Table,
  TableProperties,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { cn } from "@/lib/utils";
import { isMaterializedViewObject, isViewObject } from "@/lib/databaseDialect";
import { schemaService } from "@/services/tauri";
import type {
  DatabaseDriver,
  SchemaObjectInfo,
  TableInfo,
} from "@/services/tauri/types";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  useDatabaseNavigationStore,
} from "@/lib/databaseNavigation";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
  type ExplorerActivationMode,
} from "@/features/database-explorer/model/explorerActivation";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import {
  EXPLORER_DIRECTORY_GROUPS,
  explorerDirectoryDefinition,
  explorerDirectoryGroupForObjectType,
  explorerDirectoryNodeKind,
  groupSchemaObjectDescriptors,
  type ExplorerDirectoryGroupKind,
} from "@/features/database-explorer/model/explorerDirectory";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";
import {
  EMPTY_EXPLORER_NODE_IDS,
  useDatabaseExplorerStore,
  useExplorerExpansionSetState,
} from "@/store/useDatabaseExplorerStore";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { resolveExplorerSelection } from "@/features/database-explorer/model/explorerSelection";
import {
  explorerTreeVisibleNodeIds,
  moveExplorerTreeFocus,
} from "@/features/database-explorer/ui/explorerTreeDom";
import { ExplorerDirectoryRow } from "@/features/database-explorer/ui/ExplorerDirectoryRow";
import { ExplorerTreeStateRow } from "@/features/database-explorer/ui/ExplorerTreeStateRow";
import { ExplorerSegmentedVirtualList } from "@/features/database-explorer/ui/ExplorerVirtualList";
import {
  EXPLORER_COMPACT_TREE_ROW_HEIGHT,
  EXPLORER_TREE_ROW_HEIGHT,
} from "@/features/database-explorer/runtime/explorerFlatTree";
import {
  EXPLORER_MENU_CONTENT_CLASS,
  EXPLORER_MENU_ITEM_CLASS,
} from "@/features/database-explorer/ui/explorerStyles";

type SchemaLoadStatus = "idle" | "loading" | "success" | "error";

interface SchemaLoadState {
  status: SchemaLoadStatus;
  tables: TableInfo[];
  objects: SchemaObjectInfo[];
  objectError: string | null;
  error: string | null;
}

interface ObjectMemberLoadState {
  status: "loading" | "success" | "error";
  members: SchemaObjectInfo[];
}

interface PostgresRemoteDatabaseContentsProps {
  explorerScopeId?: string;
  connectionId: string;
  driver?: DatabaseDriver;
  database: string;
  schemas: string[];
  refreshRequest?: { version: number; schema?: string };
  filterText?: string;
  matchesFilter?: (...values: Array<unknown>) => boolean;
  activationMode: ExplorerActivationMode;
  onTablesLoaded?: (schema: string, tables: TableInfo[]) => void;
  onOpenSchemaSnapshots?: (database: string, schema: string) => void;
  onOpenSchemaObjects?: (database: string, schema: string) => void;
  /** Query-console actions supplied by the Explorer host for this namespace. */
  renderQueryContextMenu?: (database: string, schema: string) => ReactNode;
  onOpenSchemaDataTransfer?: (database: string, schema: string) => void;
  onOpenSchemaDataCompare?: (database: string, schema: string) => void;
  onOpenTableSchemaSnapshots?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onOpenTableDataTransfer?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onOpenTableDataCompare?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onOpenTableMaintenance?: (
    database: string,
    schema: string,
    table: string,
  ) => void;
  onImportSqlScript?: (database: string, schema: string) => void;
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  onOpenTable: (
    database: string,
    schema: string,
    table: TableInfo,
  ) => void | Promise<void>;
}

function loadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || "Schema metadata could not be loaded");
}

const menuContentClass = EXPLORER_MENU_CONTENT_CLASS;
const menuItemClass = EXPLORER_MENU_ITEM_CLASS;

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function directoryIcon(kind: ExplorerDirectoryGroupKind) {
  const definition = explorerDirectoryDefinition(kind);
  const className = cn(
    "shrink-0",
    explorerObjectIconClass(definition.iconKind),
  );
  if (kind === "tables") return <Table size={11} className={className} />;
  if (kind === "views" || kind === "materialized-views") {
    return <TableProperties size={11} className={className} />;
  }
  if (kind === "procedures" || kind === "functions") {
    return <SquareFunction size={11} className={className} />;
  }
  if (kind === "triggers") return <Zap size={11} className={className} />;
  if (kind === "events" || kind === "jobs") {
    return <Clock3 size={11} className={className} />;
  }
  if (kind === "sequences") {
    return <ListOrdered size={11} className={className} />;
  }
  if (kind === "synonyms") return <Link2 size={11} className={className} />;
  if (kind === "packages") return <Package size={11} className={className} />;
  return <Braces size={11} className={className} />;
}

export function PostgresRemoteDatabaseContents({
  explorerScopeId,
  connectionId,
  driver = "postgres",
  database,
  schemas,
  refreshRequest,
  filterText = "",
  matchesFilter,
  activationMode = "single",
  onTablesLoaded,
  onOpenSchemaSnapshots,
  onOpenSchemaObjects,
  renderQueryContextMenu,
  onOpenSchemaDataTransfer,
  onOpenSchemaDataCompare,
  onOpenTableSchemaSnapshots,
  onOpenTableDataTransfer,
  onOpenTableDataCompare,
  onOpenTableMaintenance,
  onImportSqlScript,
  includeIndexes = true,
  includeConstraints = true,
  onOpenTable,
}: PostgresRemoteDatabaseContentsProps) {
  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest,
  );
  const clearDatabaseReveal = useDatabaseNavigationStore(
    (state) => state.clearReveal,
  );
  const treeId = useId();
  const resolvedExplorerScopeId =
    explorerScopeId ?? `postgres-remote-tree:${treeId}`;
  const expansionNamespace = `${connectionId}:${database}`;
  const [expandedSchemas, setExpandedSchemas] = useExplorerExpansionSetState(
    resolvedExplorerScopeId,
    "schemas",
    expansionNamespace,
  );
  const [expandedGroups, setExpandedGroups] = useExplorerExpansionSetState(
    resolvedExplorerScopeId,
    "groups",
    expansionNamespace,
  );
  const [expandedTables, setExpandedTables] = useExplorerExpansionSetState(
    resolvedExplorerScopeId,
    "objects",
    `${expansionNamespace}:relations`,
  );
  const [expandedObjectKeys, setExpandedObjectKeys] =
    useExplorerExpansionSetState(
      resolvedExplorerScopeId,
      "objects",
      `${expansionNamespace}:members`,
    );
  const selectedNodeIds = useDatabaseExplorerStore(
    (state) =>
      state.scopes[resolvedExplorerScopeId]?.selectedNodeIds ??
      EMPTY_EXPLORER_NODE_IDS,
  );
  const selectionAnchorId = useDatabaseExplorerStore(
    (state) => state.scopes[resolvedExplorerScopeId]?.selectionAnchorId ?? null,
  );
  const setSelection = useDatabaseExplorerStore((state) => state.setSelection);
  const explorerViewMode = useDatabaseExplorerStore(
    (state) =>
      state.scopes[resolvedExplorerScopeId]?.viewMode ?? "hierarchical",
  );
  const explorerTreeRowHeight =
    explorerViewMode === "flat"
      ? EXPLORER_COMPACT_TREE_ROW_HEIGHT
      : EXPLORER_TREE_ROW_HEIGHT;
  const selectNode = (
    nodeId: string,
    event?: {
      currentTarget: HTMLElement;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    const result = resolveExplorerSelection({
      visibleNodeIds: event
        ? explorerTreeVisibleNodeIds(event.currentTarget)
        : [nodeId],
      selectedNodeIds,
      targetNodeId: nodeId,
      anchorNodeId: selectionAnchorId,
      additive: Boolean(event?.ctrlKey || event?.metaKey),
      range: Boolean(event?.shiftKey),
    });
    setSelection(
      resolvedExplorerScopeId,
      result.selectedNodeIds,
      result.focusedNodeId,
      result.anchorNodeId,
    );
  };
  const [objectMemberLoads, setObjectMemberLoads] = useState<
    Record<string, ObjectMemberLoadState>
  >({});
  const [schemaLoads, setSchemaLoads] = useState<
    Record<string, SchemaLoadState>
  >({});
  const mountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<string, number>>({});
  const inFlightSchemasRef = useRef<Set<string>>(new Set());
  const contextVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    contextVersionRef.current += 1;
    setObjectMemberLoads({});
    setSchemaLoads({});
    requestVersionsRef.current = {};
    inFlightSchemasRef.current.clear();
  }, [connectionId, database]);

  const loadTables = async (schema: string) => {
    if (inFlightSchemasRef.current.has(schema)) return;
    inFlightSchemasRef.current.add(schema);
    const requestVersion = (requestVersionsRef.current[schema] || 0) + 1;
    const contextVersion = contextVersionRef.current;
    requestVersionsRef.current[schema] = requestVersion;
    setSchemaLoads((current) => ({
      ...current,
      [schema]: {
        status: "loading",
        tables: current[schema]?.tables || [],
        objects: current[schema]?.objects || [],
        objectError: null,
        error: null,
      },
    }));

    try {
      const schemaObjectRequest =
        typeof schemaService.getDatabaseSchemaObjects === "function"
          ? schemaService
              .getDatabaseSchemaObjects(connectionId, database, schema)
              .then((objects) => ({ objects, error: null }))
              .catch(() => ({
                objects: [] as SchemaObjectInfo[],
                error:
                  "Schema object metadata is unavailable for this server role",
              }))
          : Promise.resolve({
              objects: [] as SchemaObjectInfo[],
              error:
                "Schema object metadata is unavailable in this application build",
            });
      const [tables, objectResult] = await Promise.all([
        schemaService.getDatabaseTables(connectionId, database, schema),
        schemaObjectRequest,
      ]);
      if (
        !mountedRef.current ||
        contextVersionRef.current !== contextVersion ||
        requestVersionsRef.current[schema] !== requestVersion
      ) {
        return;
      }
      setSchemaLoads((current) => ({
        ...current,
        [schema]: {
          status: "success",
          tables,
          objects: objectResult.objects,
          objectError: objectResult.error,
          error: null,
        },
      }));
      onTablesLoaded?.(schema, tables);
    } catch (error) {
      if (
        !mountedRef.current ||
        contextVersionRef.current !== contextVersion ||
        requestVersionsRef.current[schema] !== requestVersion
      ) {
        return;
      }
      setSchemaLoads((current) => ({
        ...current,
        [schema]: {
          status: "error",
          tables: current[schema]?.tables || [],
          objects: current[schema]?.objects || [],
          objectError: current[schema]?.objectError || null,
          error: loadErrorMessage(error),
        },
      }));
    } finally {
      if (
        contextVersionRef.current === contextVersion &&
        requestVersionsRef.current[schema] === requestVersion
      ) {
        inFlightSchemasRef.current.delete(schema);
      }
    }
  };

  const toggleSchema = (schema: string) => {
    const willExpand = !expandedSchemas.has(schema);
    setExpandedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });

    const loadState = schemaLoads[schema];
    if (
      willExpand &&
      loadState?.status !== "loading" &&
      loadState?.status !== "success"
    ) {
      setExpandedGroups((current) => {
        const next = new Set(current);
        next.add(`${schema}:tables`);
        next.add(`${schema}:views`);
        return next;
      });
      void loadTables(schema);
    }
  };

  const toggleGroup = (schema: string, kind: ExplorerDirectoryGroupKind) => {
    const key = `${schema}:${kind}`;
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleTable = (schema: string, table: string) => {
    const key = `${schema}:${table}`;
    setExpandedTables((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleObjectMembers = (schema: string, object: SchemaObjectInfo) => {
    if (!object.membersExpandable) return;
    const key = `${schema}:${object.objectType}:${object.name}`;
    const isExpanded = expandedObjectKeys.has(key);
    const isRetry = isExpanded && objectMemberLoads[key]?.status === "error";
    const willExpand = isRetry || !isExpanded;
    if (!isRetry) {
      setExpandedObjectKeys((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
    }
    if (!willExpand || objectMemberLoads[key]?.status === "success") return;
    setObjectMemberLoads((current) => ({
      ...current,
      [key]: { status: "loading", members: [] },
    }));
    if (typeof schemaService.getDatabaseSchemaObjectMembers !== "function") {
      setObjectMemberLoads((current) => ({
        ...current,
        [key]: { status: "error", members: [] },
      }));
      return;
    }
    void schemaService
      .getDatabaseSchemaObjectMembers(
        connectionId,
        database,
        schema,
        object.name,
        object.objectType,
      )
      .then((members) =>
        setObjectMemberLoads((current) => ({
          ...current,
          [key]: { status: "success", members },
        })),
      )
      .catch(() =>
        setObjectMemberLoads((current) => ({
          ...current,
          [key]: { status: "error", members: [] },
        })),
      );
  };

  useEffect(() => {
    if (!refreshRequest?.version) return;
    const targets = refreshRequest.schema
      ? [refreshRequest.schema]
      : [...expandedSchemas];
    targets
      .filter((schema) => schemas.includes(schema))
      .forEach((schema) => void loadTables(schema));
  }, [connectionId, database, refreshRequest?.version]);

  useEffect(() => {
    const target = databaseRevealRequest?.target;
    if (
      !target ||
      target.connectionId !== connectionId ||
      target.databaseName !== database ||
      !target.schemaName ||
      !schemas.includes(target.schemaName)
    ) {
      return;
    }
    const schemaName = target.schemaName;
    setExpandedSchemas((current) =>
      current.has(schemaName) ? current : new Set([...current, schemaName]),
    );
    const loadState = schemaLoads[schemaName];
    if (
      target.objectName &&
      loadState?.status !== "loading" &&
      loadState?.status !== "success"
    ) {
      void loadTables(schemaName);
    }
  }, [databaseRevealRequest?.id, schemas]);

  useEffect(() => {
    if (!databaseRevealRequest) return;
    const { id: requestId, target } = databaseRevealRequest;
    if (
      target.connectionId !== connectionId ||
      target.databaseName !== database ||
      !target.schemaName ||
      (target.objectName &&
        schemaLoads[target.schemaName]?.status !== "success")
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      const key = target.objectName
        ? databaseObjectNavigationKey({
            ...target,
            objectName: target.objectName,
          })
        : databaseSchemaNavigationKey(target);
      const element = document.querySelector<HTMLElement>(
        target.objectName
          ? `[data-database-object-key="${key}"]`
          : `[data-database-schema-key="${key}"]`,
      );
      element?.scrollIntoView({ block: "nearest" });
      element?.focus();
      clearDatabaseReveal(requestId);
    });
  }, [
    clearDatabaseReveal,
    connectionId,
    database,
    databaseRevealRequest,
    schemaLoads,
  ]);

  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const visibleSchemas = normalizedFilter
    ? schemas.filter(
        (schema) =>
          (matchesFilter
            ? matchesFilter(schema)
            : schema.toLocaleLowerCase().includes(normalizedFilter)) ||
          schemaLoads[schema]?.tables.some((table) =>
            matchesFilter
              ? matchesFilter(table.name, table.comment)
              : table.name.toLocaleLowerCase().includes(normalizedFilter),
          ),
      )
    : schemas;

  if (schemas.length === 0) {
    return (
      <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
        No schemas found
      </div>
    );
  }

  if (visibleSchemas.length === 0) {
    return (
      <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
        No schemas match “{filterText.trim()}”
      </div>
    );
  }

  return (
    <ExplorerContextMenuHost>
      <div data-postgres-remote-database={database} className="min-w-0">
        {visibleSchemas.map((schema) => {
          const isExpanded = expandedSchemas.has(schema);
          const nodeId = explorerNodeId(
            "schema",
            connectionId,
            database,
            schema,
          );
          const isSelected = selectedNodeIds.includes(nodeId);
          const loadState = schemaLoads[schema] || {
            status: "idle" as const,
            tables: [],
            objects: [],
            objectError: null,
            error: null,
          };
          const schemaMatchesFilter = matchesFilter
            ? matchesFilter(schema)
            : schema.toLocaleLowerCase().includes(normalizedFilter);
          const visibleTables =
            normalizedFilter && !schemaMatchesFilter
              ? loadState.tables.filter((table) =>
                  matchesFilter
                    ? matchesFilter(table.name, table.comment)
                    : table.name.toLocaleLowerCase().includes(normalizedFilter),
                )
              : loadState.tables;
          const visibleObjects =
            normalizedFilter && !schemaMatchesFilter
              ? loadState.objects.filter((object) =>
                  matchesFilter
                    ? matchesFilter(
                        object.name,
                        object.objectType,
                        object.parentName,
                      )
                    : `${object.name} ${object.objectType} ${object.parentName || ""}`
                        .toLocaleLowerCase()
                        .includes(normalizedFilter),
                )
              : loadState.objects;
          const relationGroups = new Map<
            ExplorerDirectoryGroupKind,
            TableInfo[]
          >([
            [
              "tables",
              visibleTables.filter((table) => !isViewObject(table.type)),
            ],
            [
              "views",
              visibleTables.filter(
                (table) =>
                  isViewObject(table.type) &&
                  !isMaterializedViewObject(table.type),
              ),
            ],
            [
              "materialized-views",
              visibleTables.filter((table) =>
                isMaterializedViewObject(table.type),
              ),
            ],
          ]);
          const descriptorGroups = groupSchemaObjectDescriptors(visibleObjects);
          const triggersByRelation = new Map<string, SchemaObjectInfo[]>();
          for (const object of visibleObjects) {
            if (
              explorerDirectoryGroupForObjectType(object.objectType) !==
                "triggers" ||
              !object.parentName
            ) {
              continue;
            }
            const relationName = object.parentName.toLocaleLowerCase();
            const triggers = triggersByRelation.get(relationName) || [];
            triggers.push(object);
            triggersByRelation.set(relationName, triggers);
          }
          const visibleGroupKinds = EXPLORER_DIRECTORY_GROUPS.filter(
            ({ kind }) =>
              kind === "tables" ||
              (relationGroups.get(kind)?.length || 0) > 0 ||
              (descriptorGroups.get(kind)?.length || 0) > 0,
          ).map(({ kind }) => kind);

          const renderRemoteRelation = (table: TableInfo) => {
            const isView = isViewObject(table.type);
            const isMaterializedView = isMaterializedViewObject(table.type);
            const tableKey = `${schema}:${table.name}`;
            const isTableExpanded = expandedTables.has(tableKey);
            const relationNodeId = explorerNodeId(
              isMaterializedView
                ? "materialized-view"
                : isView
                  ? "view"
                  : "table",
              connectionId,
              database,
              schema,
              table.name,
            );
            const isRelationSelected = selectedNodeIds.includes(relationNodeId);
            const triggers =
              triggersByRelation.get(table.name.toLocaleLowerCase()) || [];
            return (
              <div key={table.name}>
                <ExplorerSharedContextMenu nodeId={relationNodeId}>
                  <ContextMenuTrigger asChild>
                    <div className="ml-4 flex h-7 min-w-0 items-center rounded-[3px] pl-1.5 hover:bg-[hsl(var(--wb-hover))]">
                      <button
                        type="button"
                        className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                        aria-label={`${isTableExpanded ? "Collapse" : "Expand"} ${table.name} metadata`}
                        aria-expanded={isTableExpanded}
                        onClick={(event) => {
                          selectNode(relationNodeId);
                          event.stopPropagation();
                          toggleTable(schema, table.name);
                        }}
                      >
                        {isTableExpanded ? (
                          <ChevronDown size={10} />
                        ) : (
                          <ChevronRight size={10} />
                        )}
                      </button>
                      <button
                        type="button"
                        role="treeitem"
                        data-explorer-node-id={relationNodeId}
                        aria-selected={isRelationSelected}
                        aria-expanded={isTableExpanded}
                        tabIndex={isRelationSelected ? 0 : -1}
                        data-database-object-key={databaseObjectNavigationKey({
                          connectionId,
                          databaseName: database,
                          schemaName: schema,
                          objectName: table.name,
                        })}
                        data-postgres-remote-table={`${database}.${schema}.${table.name}`}
                        onClick={(event) => {
                          selectNode(relationNodeId, event);
                          if (
                            shouldActivateExplorerObject(
                              activationMode,
                              "click",
                              event.detail,
                            )
                          ) {
                            void onOpenTable(database, schema, table);
                          }
                        }}
                        onDoubleClick={() => {
                          if (
                            shouldActivateExplorerObject(
                              activationMode,
                              "double-click",
                            )
                          ) {
                            void onOpenTable(database, schema, table);
                          }
                        }}
                        onContextMenu={() => selectNode(relationNodeId)}
                        onKeyDown={(event) => {
                          if (
                            event.key === "ArrowDown" ||
                            event.key === "ArrowUp"
                          ) {
                            event.preventDefault();
                            const nextId = moveExplorerTreeFocus(
                              event.currentTarget,
                              event.key === "ArrowDown" ? 1 : -1,
                            );
                            if (nextId) {
                              selectNode(nextId);
                            }
                          } else if (event.key === "Enter") {
                            event.preventDefault();
                            void onOpenTable(database, schema, table);
                          }
                        }}
                        className={cn(
                          "flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[3px] pr-2 text-left text-[11px]",
                          "text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))]",
                          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]",
                          isRelationSelected && "wb-tree-row-selected",
                        )}
                        title={`${explorerActivationLabel(activationMode)} to open ${database}.${schema}.${table.name} data`}
                      >
                        <Table
                          size={12}
                          className={cn(
                            "shrink-0 opacity-90",
                            explorerObjectIconClass(
                              isMaterializedView
                                ? "materialized-view"
                                : isView
                                  ? "view"
                                  : "table",
                            ),
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {table.name}
                        </span>
                        {table.comment?.trim() && (
                          <span className="max-w-[34%] truncate text-[9px] opacity-65">
                            {table.comment.trim()}
                          </span>
                        )}
                      </button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className={menuContentClass}>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void copyText(table.name)}
                    >
                      <Clipboard className="mr-2 h-3.5 w-3.5" />
                      Copy Name
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() =>
                        void copyText(`${database}.${schema}.${table.name}`)
                      }
                    >
                      Copy Qualified Name
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void onOpenTable(database, schema, table)}
                    >
                      <TableProperties className="mr-2 h-3.5 w-3.5" />
                      Open Data
                    </ContextMenuItem>
                    {renderQueryContextMenu?.(database, schema)}
                    {onOpenTableSchemaSnapshots && (
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          onOpenTableSchemaSnapshots(
                            database,
                            schema,
                            table.name,
                          )
                        }
                      >
                        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                        Schema Snapshots / Diff...
                      </ContextMenuItem>
                    )}
                    {!isView && onOpenTableDataTransfer && (
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          onOpenTableDataTransfer(database, schema, table.name)
                        }
                      >
                        <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                        Transfer Table Data...
                      </ContextMenuItem>
                    )}
                    {!isView && onOpenTableDataCompare && (
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          onOpenTableDataCompare(database, schema, table.name)
                        }
                      >
                        <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                        Compare Table Data...
                      </ContextMenuItem>
                    )}
                    {!isView && onOpenTableMaintenance && (
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          onOpenTableMaintenance(database, schema, table.name)
                        }
                      >
                        <Wrench className="mr-2 h-3.5 w-3.5" />
                        Maintain Table...
                      </ContextMenuItem>
                    )}
                    {onImportSqlScript && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() => onImportSqlScript(database, schema)}
                        >
                          <Upload className="mr-2 h-3.5 w-3.5" />
                          Import SQL Script...
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ExplorerSharedContextMenu>
                {isTableExpanded && (
                  <TableObjectTree
                    identity={{
                      connectionId,
                      driver,
                      databaseName: database,
                      schema,
                      table: table.name,
                    }}
                    includeIndexes={!isView && includeIndexes}
                    includeConstraints={!isView && includeConstraints}
                    triggers={triggers}
                  />
                )}
              </div>
            );
          };

          const renderRemoteObject = (
            kind: ExplorerDirectoryGroupKind,
            object: SchemaObjectInfo,
          ) => {
            const memberKey = `${schema}:${object.objectType}:${object.name}`;
            const membersExpanded = expandedObjectKeys.has(memberKey);
            const memberLoad = objectMemberLoads[memberKey];
            const objectNodeId = explorerNodeId(
              explorerDirectoryNodeKind(kind),
              connectionId,
              database,
              schema,
              object.name,
              object.objectType,
              object.parentName,
            );
            const isObjectSelected = selectedNodeIds.includes(objectNodeId);
            return (
              <div
                key={`${object.objectType}:${object.name}:${object.parentName || ""}`}
              >
                <ExplorerSharedContextMenu nodeId={objectNodeId}>
                  <ContextMenuTrigger asChild>
                    <div
                      role="treeitem"
                      data-explorer-node-id={objectNodeId}
                      aria-selected={isObjectSelected}
                      aria-expanded={
                        object.membersExpandable ? membersExpanded : undefined
                      }
                      tabIndex={isObjectSelected ? 0 : -1}
                      className={cn(
                        "ml-4 flex h-7 min-w-0 items-center gap-1.5 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                        isObjectSelected && "wb-tree-row-selected",
                      )}
                      onClick={(event) => selectNode(objectNodeId, event)}
                      onContextMenu={() => selectNode(objectNodeId)}
                      onDoubleClick={() =>
                        object.membersExpandable &&
                        toggleObjectMembers(schema, object)
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "ArrowDown" ||
                          event.key === "ArrowUp"
                        ) {
                          event.preventDefault();
                          const nextId = moveExplorerTreeFocus(
                            event.currentTarget,
                            event.key === "ArrowDown" ? 1 : -1,
                          );
                          if (nextId) {
                            selectNode(nextId);
                          }
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          if (object.membersExpandable) {
                            toggleObjectMembers(schema, object);
                          }
                        }
                      }}
                      title={[
                        object.objectType,
                        object.parentName,
                        object.comment,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    >
                      {object.membersExpandable && (
                        <button
                          type="button"
                          className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))]"
                          aria-label={`${membersExpanded ? "Collapse" : "Expand"} ${object.name} members`}
                          aria-expanded={membersExpanded}
                          onClick={() => toggleObjectMembers(schema, object)}
                        >
                          {membersExpanded ? (
                            <ChevronDown size={10} />
                          ) : (
                            <ChevronRight size={10} />
                          )}
                        </button>
                      )}
                      {directoryIcon(kind)}
                      <span className="min-w-0 flex-1 truncate">
                        {object.name}
                      </span>
                      {object.parentName && (
                        <span className="max-w-[35%] truncate text-[9px] opacity-60">
                          {object.parentName}
                        </span>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className={menuContentClass}>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => void copyText(object.name)}
                    >
                      <Clipboard className="mr-2 h-3.5 w-3.5" />
                      Copy Name
                    </ContextMenuItem>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() =>
                        void copyText(`${database}.${schema}.${object.name}`)
                      }
                    >
                      Copy Qualified Name
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ExplorerSharedContextMenu>
                {membersExpanded && (
                  <div className="ml-7 border-l border-[hsl(var(--wb-border-subtle))] pl-2">
                    {memberLoad?.status === "loading" ? (
                      <div className="h-5 py-0.5 text-[10px] italic wb-muted">
                        Loading members...
                      </div>
                    ) : memberLoad?.status === "error" ? (
                      <button
                        type="button"
                        className="h-5 text-[10px] text-destructive"
                        onClick={() => toggleObjectMembers(schema, object)}
                      >
                        Unable to load members; retry
                      </button>
                    ) : memberLoad?.members.length ? (
                      memberLoad.members.map((member) => (
                        <div
                          key={`${member.objectType}:${member.name}`}
                          className="flex h-5 min-w-0 items-center gap-1.5 text-[10px] wb-muted"
                        >
                          <SquareFunction size={9} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            {member.name}
                          </span>
                          <span className="shrink-0 uppercase opacity-55">
                            {member.objectType}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="h-5 py-0.5 text-[10px] italic wb-muted">
                        No members found
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          };

          return (
            <div key={schema} className="min-w-0">
              <ExplorerSharedContextMenu nodeId={nodeId}>
                <ContextMenuTrigger asChild>
                  <div
                    role="treeitem"
                    data-explorer-node-id={nodeId}
                    aria-expanded={isExpanded}
                    aria-selected={isSelected}
                    aria-busy={loadState.status === "loading" || undefined}
                    tabIndex={isSelected ? 0 : -1}
                    data-database-schema-key={databaseSchemaNavigationKey({
                      connectionId,
                      databaseName: database,
                      schemaName: schema,
                    })}
                    onClick={(event) => selectNode(nodeId, event)}
                    onContextMenu={() => selectNode(nodeId)}
                    onDoubleClick={() => toggleSchema(schema)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        selectNode(nodeId);
                      } else if (event.key === " ") {
                        event.preventDefault();
                        toggleSchema(schema);
                      } else if (event.key === "ArrowRight" && !isExpanded) {
                        event.preventDefault();
                        toggleSchema(schema);
                      } else if (event.key === "ArrowLeft" && isExpanded) {
                        event.preventDefault();
                        toggleSchema(schema);
                      } else if (
                        event.key === "ArrowDown" ||
                        event.key === "ArrowUp"
                      ) {
                        event.preventDefault();
                        const nextId = moveExplorerTreeFocus(
                          event.currentTarget,
                          event.key === "ArrowDown" ? 1 : -1,
                        );
                        if (nextId) {
                          selectNode(nextId);
                        }
                      }
                    }}
                    className={cn(
                      "flex h-7 w-full min-w-0 items-center gap-1 rounded-[3px] px-1 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]",
                      isSelected && "wb-tree-row-selected",
                    )}
                    title={`${isExpanded ? "Collapse" : "Expand"} ${database}.${schema}`}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} ${database}.${schema}`}
                      className="inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover-strong))] hover:text-[hsl(var(--wb-text))]"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSchema(schema);
                      }}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <span className="sr-only">{schema}</span>
                      {isExpanded ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRight size={12} />
                      )}
                    </button>
                    <Network
                      size={12}
                      className={cn(
                        "shrink-0",
                        explorerObjectIconClass("schema"),
                      )}
                    />
                    <span className="truncate">{schema}</span>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className={menuContentClass}>
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() => void copyText(schema)}
                  >
                    <Clipboard className="mr-2 h-3.5 w-3.5" />
                    Copy Name
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {onOpenSchemaObjects && (
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => onOpenSchemaObjects(database, schema)}
                    >
                      <TableProperties className="mr-2 h-3.5 w-3.5" />
                      Open Object Browser
                    </ContextMenuItem>
                  )}
                  {renderQueryContextMenu?.(database, schema)}
                  {onOpenSchemaSnapshots && (
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => onOpenSchemaSnapshots(database, schema)}
                    >
                      <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                      Schema Snapshots / Diff...
                    </ContextMenuItem>
                  )}
                  {onOpenSchemaDataTransfer && (
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => onOpenSchemaDataTransfer(database, schema)}
                    >
                      <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                      Transfer Schema Data...
                    </ContextMenuItem>
                  )}
                  {onOpenSchemaDataCompare && (
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => onOpenSchemaDataCompare(database, schema)}
                    >
                      <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                      Compare Schema Data...
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() => void loadTables(schema)}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Load All / Refresh
                  </ContextMenuItem>
                  {onImportSqlScript && (
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() => onImportSqlScript(database, schema)}
                    >
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      Import SQL Script...
                    </ContextMenuItem>
                  )}
                </ContextMenuContent>
              </ExplorerSharedContextMenu>

              {isExpanded && (
                <div className="wb-explorer-children">
                  {loadState.status === "loading" && (
                    <ExplorerTreeStateRow
                      state="loading"
                      ariaLabel={`Loading schema ${schema}`}
                    >
                      Loading objects…
                    </ExplorerTreeStateRow>
                  )}

                  {loadState.status === "error" && (
                    <ExplorerTreeStateRow
                      state="error"
                      title={loadState.error || undefined}
                      ariaLabel={`Failed to load schema ${schema}`}
                      onRetry={() => void loadTables(schema)}
                      retryAriaLabel={`Retry loading schema ${schema}`}
                    >
                      {loadState.error || "Schema objects unavailable"}
                    </ExplorerTreeStateRow>
                  )}

                  {loadState.status === "success" &&
                    visibleGroupKinds.map((kind) => {
                      const relations = relationGroups.get(kind) || [];
                      const objects = descriptorGroups.get(kind) || [];
                      const groupKey = `${schema}:${kind}`;
                      const isGroupExpanded = expandedGroups.has(groupKey);
                      return (
                        <div key={kind}>
                          <ExplorerDirectoryRow
                            label={explorerDirectoryDefinition(kind).label}
                            icon={directoryIcon(kind)}
                            count={relations.length + objects.length}
                            expanded={isGroupExpanded}
                            inset
                            onToggle={() => toggleGroup(schema, kind)}
                            onRefresh={() => void loadTables(schema)}
                          />
                          {isGroupExpanded && (
                            <ExplorerSegmentedVirtualList
                              items={relations}
                              rowHeight={explorerTreeRowHeight}
                              getKey={(table) => table.name}
                              renderItem={renderRemoteRelation}
                              isExpanded={(table) =>
                                expandedTables.has(`${schema}:${table.name}`)
                              }
                            />
                          )}
                          {isGroupExpanded && (
                            <ExplorerSegmentedVirtualList
                              items={objects}
                              rowHeight={explorerTreeRowHeight}
                              getKey={(object) =>
                                `${object.objectType}:${object.name}:${object.parentName || ""}`
                              }
                              renderItem={(object) =>
                                renderRemoteObject(kind, object)
                              }
                              isExpanded={(object) =>
                                expandedObjectKeys.has(
                                  `${schema}:${object.objectType}:${object.name}`,
                                )
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                  {loadState.status === "success" && loadState.objectError && (
                    <ExplorerTreeStateRow
                      state="notice"
                      title={loadState.objectError}
                    >
                      Some object types could not be loaded
                    </ExplorerTreeStateRow>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ExplorerContextMenuHost>
  );
}
