import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { ExplorerActivationMode } from "@/features/database-explorer/model/explorerActivation";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "@/features/database-explorer/model/explorerActivation";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { moveExplorerTreeFocus } from "@/features/database-explorer/runtime/explorerTreeDom";
import { copyText } from "@/features/database-explorer/runtime/remoteCatalogClipboard";
import { ExplorerSharedContextMenu } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import {
  menuContentClass,
  menuItemClass,
} from "@/features/database-explorer/ui/remoteCatalogPresentation";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";
import { isMaterializedViewObject, isViewObject } from "@/lib/databaseDialect";
import { databaseObjectNavigationKey } from "@/lib/databaseNavigation";
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
  Table,
  TableProperties,
  Upload,
  Wrench,
} from "lucide-react";

interface CreateRemoteRelationRendererContext {
  schema: string;
  expandedTables: Set<string>;
  connectionId: string;
  database: string;
  selectedNodeIds: string[];
  triggersByRelation: Map<string, SchemaObjectInfo[]>;
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
}

export function createRemoteRelationRenderer({
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
}: CreateRemoteRelationRendererContext) {
  const renderRemoteRelation = (table: TableInfo) => {
    const isView = isViewObject(table.type);
    const isMaterializedView = isMaterializedViewObject(table.type);
    const tableKey = `${schema}:${table.name}`;
    const isTableExpanded = expandedTables.has(tableKey);
    const relationNodeId = explorerNodeId(
      isMaterializedView ? "materialized-view" : isView ? "view" : "table",
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
                    shouldActivateExplorerObject(activationMode, "double-click")
                  ) {
                    void onOpenTable(database, schema, table);
                  }
                }}
                onContextMenu={() => selectNode(relationNodeId)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
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
                <span className="min-w-0 flex-1 truncate">{table.name}</span>
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
                  onOpenTableSchemaSnapshots(database, schema, table.name)
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

  return { renderRemoteRelation };
}
