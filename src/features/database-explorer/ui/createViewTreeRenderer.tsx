import type { useTabStore } from "@/store/useTabStore";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "@/features/database-explorer/model/explorerActivation";
import { explorerDirectoryDefinition } from "@/features/database-explorer/model/explorerDirectory";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import {
  objectGroupKey,
  tableTreeKey,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { ExplorerDirectoryRow as ExplorerDirectoryGroupRow } from "@/features/database-explorer/ui/ExplorerDirectoryRow";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { moveExplorerTreeFocus } from "@/features/database-explorer/ui/explorerTreeDom";
import { ExplorerSegmentedVirtualList } from "@/features/database-explorer/ui/ExplorerVirtualList";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";
import { type TableOperationTarget } from "@/hooks/useTableOperations";
import {
  isMaterializedViewObject,
  previewTableQuery,
} from "@/lib/databaseDialect";
import { databaseObjectNavigationKey } from "@/lib/databaseNavigation";
import { cn } from "@/lib/utils";
import type { DatabaseDriver, TableInfo } from "@/services/tauri/types";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Eye,
  Plus,
  RefreshCw,
  TableProperties,
} from "lucide-react";

type TabState = ReturnType<typeof useTabStore.getState>;

interface CreateViewTreeRendererContext {
  canBrowseTables: boolean;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  isCurrentSchema: boolean;
  selectedTable: string | null;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  schema: string;
  selectedExplorerNodeIds: string[];
  driver: string | null | undefined;
  activeDriver: import("@/services/tauri/types").DatabaseDriver;
  expandedTableKeys: string[];
  selectExplorerNode: (
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
  explorerActivationMode: import("@/lib/appSettings").ExplorerActivationMode;
  handleTableDoubleClick: (
    table: import("@/services/tauri/types").TableInfo,
    schemaName?: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  handleTableSelect: (tableName: string) => void;
  setExpandedTableKeys: React.Dispatch<React.SetStateAction<string[]>>;
  showExplorerHoverTooltips: boolean;

  createTab: TabState["createTab"];
  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  objectDriver: import("@/services/tauri/types").DatabaseDriver | undefined;
  renderSqlHistorySubmenu: (scope: {
    connectionId: string;
    databaseName?: string | null | undefined;
    schemaName?: string | null | undefined;
  }) => React.ReactNode;
  handleDdlClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  handleEditViewClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  handleRefreshMaterializedViewClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;

  copyText: (value: string) => Promise<void>;
  handleCopyTableDdl: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  activeProjectId: string;
  expandedObjectGroupKeys: string[];
  toggleObjectGroup: (key: string) => void;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  handleCreateView: () => void;
  handleCreateMaterializedView: () => void;
  filterText: string;
  explorerTreeRowHeight: 22 | 28;
  virtualViews: import("@/services/tauri/types").TableInfo[];
}

export function createViewTreeRenderer({
  canBrowseTables,
  activeCapabilities,
  isCurrentSchema,
  selectedTable,
  connectionId,
  navigationDatabaseName,
  schema,
  selectedExplorerNodeIds,
  driver,
  activeDriver,
  expandedTableKeys,
  selectExplorerNode,
  explorerActivationMode,
  handleTableDoubleClick,
  runForSchema,
  handleTableSelect,
  setExpandedTableKeys,
  showExplorerHoverTooltips,

  createTab,
  objectConnection,
  objectDriver,
  renderSqlHistorySubmenu,
  handleDdlClick,
  handleEditViewClick,
  handleRefreshMaterializedViewClick,

  copyText,
  handleCopyTableDdl,
  activeProjectId,
  expandedObjectGroupKeys,
  toggleObjectGroup,
  loadTables,
  handleCreateView,
  handleCreateMaterializedView,
  filterText,
  explorerTreeRowHeight,
  virtualViews,
}: CreateViewTreeRendererContext) {
  const renderVirtualViews = () => {
    if (!canBrowseTables || !activeCapabilities.supportsViews) return null;
    const renderViewRow = (view: TableInfo) => {
      const isSelectedView = isCurrentSchema && selectedTable === view.name;
      const isMaterializedView = isMaterializedViewObject(view.type);
      const viewExplorerNodeId = explorerNodeId(
        isMaterializedView ? "materialized-view" : "view",
        connectionId,
        navigationDatabaseName,
        schema,
        view.name,
      );
      const isExplorerViewSelected =
        selectedExplorerNodeIds.includes(viewExplorerNodeId);
      const qualifiedName = schema ? `${schema}.${view.name}` : view.name;
      const viewOperationTarget: TableOperationTarget = {
        connectionId,
        schema,
        driver: (driver || activeDriver) as DatabaseDriver,
      };
      const viewTreeKey = tableTreeKey(
        connectionId,
        driver,
        navigationDatabaseName,
        schema,
        view.name,
      );
      const isViewExpanded = expandedTableKeys.includes(viewTreeKey);
      return (
        <div key={`${schema}:view:${view.name}`}>
          <ExplorerSharedContextMenu nodeId={viewExplorerNodeId}>
            <ContextMenuTrigger asChild>
              <div
                role="treeitem"
                data-explorer-node-id={viewExplorerNodeId}
                data-database-object-key={databaseObjectNavigationKey({
                  connectionId,
                  databaseName: navigationDatabaseName,
                  schemaName: schema,
                  objectName: view.name,
                })}
                tabIndex={isExplorerViewSelected ? 0 : -1}
                aria-selected={isExplorerViewSelected}
                aria-expanded={isViewExpanded}
                className={cn(
                  "group ml-4 flex h-7 cursor-pointer items-center gap-2 rounded-[3px] px-2 text-[11px]",
                  isSelectedView || isExplorerViewSelected
                    ? "wb-tree-row-selected"
                    : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                )}
                onClick={(event) => {
                  selectExplorerNode(viewExplorerNodeId, event);
                  if (
                    shouldActivateExplorerObject(
                      explorerActivationMode,
                      "click",
                      event.detail,
                    )
                  ) {
                    void handleTableDoubleClick(
                      view,
                      schema,
                      connectionId,
                      navigationDatabaseName,
                    );
                    return;
                  }
                  void runForSchema(schema, () => handleTableSelect(view.name));
                }}
                onContextMenu={() => selectExplorerNode(viewExplorerNodeId)}
                onDoubleClick={() => {
                  if (
                    shouldActivateExplorerObject(
                      explorerActivationMode,
                      "double-click",
                    )
                  ) {
                    void handleTableDoubleClick(
                      view,
                      schema,
                      connectionId,
                      navigationDatabaseName,
                    );
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    moveExplorerTreeFocus(
                      event.currentTarget,
                      event.key === "ArrowDown" ? 1 : -1,
                    );
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    void handleTableDoubleClick(
                      view,
                      schema,
                      connectionId,
                      navigationDatabaseName,
                    );
                  }
                }}
                title={`${explorerActivationLabel(explorerActivationMode)} to open ${schema}.${view.name} data`}
              >
                <button
                  type="button"
                  className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                  aria-label={`${isViewExpanded ? "Collapse" : "Expand"} ${view.name} metadata`}
                  aria-expanded={isViewExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedTableKeys((current) =>
                      current.includes(viewTreeKey)
                        ? current.filter((key) => key !== viewTreeKey)
                        : [...current, viewTreeKey],
                    );
                  }}
                >
                  {isViewExpanded ? (
                    <ChevronDown size={10} />
                  ) : (
                    <ChevronRight size={10} />
                  )}
                </button>
                <TableProperties
                  size={12}
                  className={cn(
                    "shrink-0 opacity-90",
                    explorerObjectIconClass(
                      isMaterializedView ? "materialized-view" : "view",
                    ),
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
                {view.comment?.trim() && (
                  <span
                    className="max-w-[34%] shrink truncate text-[9px] text-[hsl(var(--wb-text-muted))] opacity-75"
                    title={
                      showExplorerHoverTooltips
                        ? view.comment.trim()
                        : undefined
                    }
                  >
                    {view.comment.trim()}
                  </span>
                )}
                {isMaterializedView && (
                  <span className="shrink-0 text-[8px] uppercase text-indigo-300/70">
                    MV
                  </span>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className={menuContentClass}>
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  void handleTableDoubleClick(
                    view,
                    schema,
                    connectionId,
                    navigationDatabaseName,
                  )
                }
              >
                <TableProperties className="mr-2 h-3.5 w-3.5" />
                Open Data
              </ContextMenuItem>
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  createTab(
                    "query",
                    `${view.name} [${objectConnection?.name || "query"}]`,
                    previewTableQuery(
                      objectDriver || activeDriver,
                      schema,
                      view.name,
                    ),
                    {
                      connectionId,
                      databaseName: navigationDatabaseName,
                      schemaName: schema,
                      tableName: view.name,
                      objectType: view.type || null,
                    },
                  )
                }
              >
                <Code2 className="mr-2 h-3.5 w-3.5" />
                Open in Query Console
              </ContextMenuItem>
              {renderSqlHistorySubmenu({
                connectionId,
                databaseName: navigationDatabaseName,
                schemaName: schema,
              })}
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  void runForSchema(schema, () =>
                    handleDdlClick(view, viewOperationTarget),
                  )
                }
              >
                <Eye className="mr-2 h-3.5 w-3.5" />
                View Source / DDL
              </ContextMenuItem>
              {!isMaterializedView && (
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    void runForSchema(schema, () =>
                      handleEditViewClick(view, viewOperationTarget),
                    )
                  }
                >
                  Edit View
                </ContextMenuItem>
              )}
              {isMaterializedView && (
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    void runForSchema(schema, () =>
                      handleRefreshMaterializedViewClick(
                        view,
                        viewOperationTarget,
                      ),
                    )
                  }
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh Materialized View
                </ContextMenuItem>
              )}
              <ContextMenuSeparator className={menuSeparatorClass} />
              <ContextMenuItem
                className={menuItemClass}
                onClick={() => void copyText(view.name)}
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
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  void runForSchema(schema, () =>
                    handleCopyTableDdl(view, viewOperationTarget),
                  )
                }
              >
                Copy DDL
              </ContextMenuItem>
            </ContextMenuContent>
          </ExplorerSharedContextMenu>
          {isViewExpanded && (
            <TableObjectTree
              identity={{
                projectId: activeProjectId,
                connectionId,
                driver: (driver || activeDriver) as DatabaseDriver,
                databaseName: navigationDatabaseName || undefined,
                schema,
                table: view.name,
              }}
              includeIndexes={
                isMaterializedView && activeCapabilities.supportsTableIndexes
              }
              includeConstraints={false}
            />
          )}
        </div>
      );
    };

    const renderViewGroup = (
      kind: "views" | "materialized-views",
      views: TableInfo[],
    ) => {
      const definition = explorerDirectoryDefinition(kind);
      const key = objectGroupKey(connectionId, driver, schema, kind);
      const isExpanded = expandedObjectGroupKeys.includes(key);
      return (
        <div key={kind}>
          <ExplorerDirectoryGroupRow
            expanded={isExpanded}
            label={definition.label}
            count={views.length}
            icon={
              <Eye
                size={12}
                className={cn(
                  "shrink-0",
                  explorerObjectIconClass(definition.iconKind),
                )}
              />
            }
            onToggle={() => toggleObjectGroup(key)}
            onRefresh={() => void loadTables(connectionId, schema, true)}
            menuActions={
              kind === "views" && activeCapabilities.supportsViews ? (
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() => void runForSchema(schema, handleCreateView)}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Create View
                </ContextMenuItem>
              ) : kind === "materialized-views" &&
                activeCapabilities.supportsMaterializedViews ? (
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    void runForSchema(schema, handleCreateMaterializedView)
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Create Materialized View
                </ContextMenuItem>
              ) : null
            }
          />
          {isExpanded &&
            (views.length === 0 ? (
              <div className="pl-7 text-[11px] italic wb-muted">
                {filterText
                  ? `No ${definition.label.toLowerCase()} match "${filterText}"`
                  : `No ${definition.label.toLowerCase()} found`}
              </div>
            ) : (
              <ExplorerContextMenuHost>
                <ExplorerSegmentedVirtualList
                  items={views}
                  rowHeight={explorerTreeRowHeight}
                  getKey={(view) => view.name}
                  renderItem={renderViewRow}
                  isExpanded={(view) =>
                    expandedTableKeys.includes(
                      tableTreeKey(
                        connectionId,
                        driver,
                        navigationDatabaseName,
                        schema,
                        view.name,
                      ),
                    )
                  }
                />
              </ExplorerContextMenuHost>
            ))}
        </div>
      );
    };

    const regularViews = virtualViews.filter(
      (view) => !isMaterializedViewObject(view.type),
    );
    const materializedViews = virtualViews.filter((view) =>
      isMaterializedViewObject(view.type),
    );

    return (
      <>
        {renderViewGroup("views", regularViews)}
        {(materializedViews.length > 0 ||
          activeCapabilities.supportsMaterializedViews) &&
          renderViewGroup("materialized-views", materializedViews)}
      </>
    );
  };

  return { renderVirtualViews };
}
