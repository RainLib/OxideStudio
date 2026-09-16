import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ExplorerActivationMode } from "@/features/database-explorer/model/explorerActivation";
import type { ExplorerDirectoryGroupKind } from "@/features/database-explorer/model/explorerDirectory";
import {
  EXPLORER_DIRECTORY_GROUPS,
  explorerDirectoryDefinition,
  explorerDirectoryGroupForObjectType,
  groupSchemaObjectDescriptors,
} from "@/features/database-explorer/model/explorerDirectory";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import type {
  ObjectMemberLoadState,
  SchemaLoadState,
} from "@/features/database-explorer/model/remoteCatalogTypes";
import { moveExplorerTreeFocus } from "@/features/database-explorer/runtime/explorerTreeDom";
import { copyText } from "@/features/database-explorer/runtime/remoteCatalogClipboard";
import { createRemoteObjectRenderer } from "@/features/database-explorer/ui/createRemoteObjectRenderer";
import { createRemoteRelationRenderer } from "@/features/database-explorer/ui/createRemoteRelationRenderer";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { ExplorerDirectoryRow } from "@/features/database-explorer/ui/ExplorerDirectoryRow";
import { ExplorerTreeStateRow } from "@/features/database-explorer/ui/ExplorerTreeStateRow";
import { ExplorerSegmentedVirtualList } from "@/features/database-explorer/ui/ExplorerVirtualList";
import {
  directoryIcon,
  menuContentClass,
  menuItemClass,
} from "@/features/database-explorer/ui/remoteCatalogPresentation";
import { isMaterializedViewObject, isViewObject } from "@/lib/databaseDialect";
import { databaseSchemaNavigationKey } from "@/lib/databaseNavigation";
import { cn } from "@/lib/utils";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import type {
  SchemaObjectInfo,
  TableInfo,
} from "@/services/tauri/types/schemaCatalog";
import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Clipboard,
  GitCompareArrows,
  Network,
  RefreshCw,
  TableProperties,
  Upload,
} from "lucide-react";

interface RemoteCatalogSchemasContext {
  database: string;
  visibleSchemas: string[];
  expandedSchemas: Set<string>;
  connectionId: string;
  selectedNodeIds: string[];
  schemaLoads: Record<string, SchemaLoadState>;
  matchesFilter: ((...values: unknown[]) => boolean) | undefined;
  normalizedFilter: string;
  expandedTables: Set<string>;
  selectNode: (
    nodeId: string,
    event?:
      | {
          currentTarget: HTMLElement;
          ctrlKey: boolean;
          metaKey: boolean;
          shiftKey: boolean;
        }
      | undefined,
  ) => void;
  toggleTable: (schema: string, table: string) => void;
  activationMode: ExplorerActivationMode;
  onOpenTable: (
    database: string,
    schema: string,
    table: TableInfo,
  ) => void | Promise<void>;
  renderQueryContextMenu:
    | ((database: string, schema: string) => React.ReactNode)
    | undefined;
  onOpenTableSchemaSnapshots:
    | ((database: string, schema: string, table: string) => void)
    | undefined;
  onOpenTableDataTransfer:
    | ((database: string, schema: string, table: string) => void)
    | undefined;
  onOpenTableDataCompare:
    | ((database: string, schema: string, table: string) => void)
    | undefined;
  onOpenTableMaintenance:
    | ((database: string, schema: string, table: string) => void)
    | undefined;
  onImportSqlScript: ((database: string, schema: string) => void) | undefined;
  driver: DatabaseDriver;
  includeIndexes: boolean;
  includeConstraints: boolean;
  expandedObjectKeys: Set<string>;
  objectMemberLoads: Record<string, ObjectMemberLoadState>;
  toggleObjectMembers: (schema: string, object: SchemaObjectInfo) => void;
  toggleSchema: (schema: string) => void;
  onOpenSchemaObjects: ((database: string, schema: string) => void) | undefined;
  onOpenSchemaSnapshots:
    | ((database: string, schema: string) => void)
    | undefined;
  onOpenSchemaDataTransfer:
    | ((database: string, schema: string) => void)
    | undefined;
  onOpenSchemaDataCompare:
    | ((database: string, schema: string) => void)
    | undefined;
  loadTables: (schema: string) => Promise<void>;
  expandedGroups: Set<string>;
  toggleGroup: (schema: string, kind: ExplorerDirectoryGroupKind) => void;
  explorerTreeRowHeight: number;
}

export function RemoteCatalogSchemas({
  database,
  visibleSchemas,
  expandedSchemas,
  connectionId,
  selectedNodeIds,
  schemaLoads,
  matchesFilter,
  normalizedFilter,
  expandedTables,
  selectNode,
  toggleTable,
  activationMode,
  onOpenTable,
  renderQueryContextMenu,
  onOpenTableSchemaSnapshots,
  onOpenTableDataTransfer,
  onOpenTableDataCompare,
  onOpenTableMaintenance,
  onImportSqlScript,
  driver,
  includeIndexes,
  includeConstraints,
  expandedObjectKeys,
  objectMemberLoads,
  toggleObjectMembers,
  toggleSchema,
  onOpenSchemaObjects,
  onOpenSchemaSnapshots,
  onOpenSchemaDataTransfer,
  onOpenSchemaDataCompare,
  loadTables,
  expandedGroups,
  toggleGroup,
  explorerTreeRowHeight,
}: RemoteCatalogSchemasContext) {
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

          const { renderRemoteRelation } = createRemoteRelationRenderer({
            schema,
            expandedTables,
            connectionId,
            database,
            selectedNodeIds,
            triggersByRelation,
            selectNode,
            toggleTable,
            activationMode,
            onOpenTable,
            renderQueryContextMenu,
            onOpenTableSchemaSnapshots,
            onOpenTableDataTransfer,
            onOpenTableDataCompare,
            onOpenTableMaintenance,
            onImportSqlScript,
            driver,
            includeIndexes,
            includeConstraints,
          });

          const { renderRemoteObject } = createRemoteObjectRenderer({
            schema,
            expandedObjectKeys,
            objectMemberLoads,
            connectionId,
            database,
            selectedNodeIds,
            selectNode,
            toggleObjectMembers,
          });

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
