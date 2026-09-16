import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useConnectionStore } from "@/store/useConnectionStore";
import type { useTabStore } from "@/store/useTabStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { tableTreeKey } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { toggleTableBatchSelection } from "@/features/database-explorer/model/tableBatchSelection";
import { ExplorerSharedContextMenu } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import {
  EXPLORER_SIDEBAR_CHECKBOX_CLASS as checkboxClass,
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { ExplorerTableNavigationMenu } from "@/features/database-explorer/ui/ExplorerTableNavigationMenu";
import { ExplorerTableStructureMenu } from "@/features/database-explorer/ui/ExplorerTableStructureMenu";
import { ExplorerTableTransferMenu } from "@/features/database-explorer/ui/ExplorerTableTransferMenu";
import { moveExplorerTreeFocus } from "@/features/database-explorer/ui/explorerTreeDom";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";
import { beginExplorerTableReferenceDrag } from "@/features/query-editor/model/explorerTableReferenceDrag";
import { explorerTableReferenceDragLabel } from "@/features/query-editor/model/explorerTableReferenceDrop";
import { type TableOperationTarget } from "@/hooks/useTableOperations";
import {
  defaultDatabaseCapabilities,
  isMaterializedViewObject,
  isReadOnlyRelationObject,
  isViewObject,
  previewTableQuery,
  qualifiedTableName,
  relationObjectLabel,
} from "@/lib/databaseDialect";
import { databaseObjectNavigationKey } from "@/lib/databaseNavigation";
import { cn } from "@/lib/utils";
import type { DatabaseDriver, TableInfo } from "@/services/tauri/types";
import {
  ChevronDown,
  ChevronRight,
  Pin,
  PinOff,
  Table,
  Trash2,
} from "lucide-react";

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

type TabState = ReturnType<typeof useTabStore.getState>;

interface CreateTableTreeRendererContext {
  schemaObjects: {
    tables: import("@/services/tauri/types").TableInfo[];
    collections: import("@/services/tauri/types").CollectionInfo[];
    functions: import("@/services/tauri/types").FunctionInfo[];
    pinnedTables: string[];
    hasSnapshot: boolean;
  };
  isCurrentSchema: boolean;
  selectedTable: string | null;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  schema: string;
  selectedExplorerNodeIds: string[];
  driver: string | null | undefined;
  expandedTableKeys: string[];
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  activeDriver: import("@/services/tauri/types").DatabaseDriver;
  selectedTableBatchSet: Set<string>;
  selectedTableBatchNames: string[];
  tableRelations: import("@/services/tauri/types").TableInfo[];
  objectDriver: import("@/services/tauri/types").DatabaseDriver | undefined;
  createTab: TabState["createTab"];
  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  handleTableSelect: (tableName: string) => void;
  explorerActivationMode: import("@/lib/appSettings").ExplorerActivationMode;
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
  suppressTableReferenceClickRef: React.RefObject<boolean>;
  isTableBatchSelectionActive: boolean;
  tableBatchAction: {
    scopeKey: string;
    running: boolean;
    message: string;
    cancelId?: string | undefined;
    failures?:
      | import("@/features/database-explorer/model/tableBatchSelection").TableBatchFailureDetail[]
      | undefined;
    omittedFailures?: number | undefined;
  } | null;
  setTableBatchSelection: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerTableBatchSelection
      | null
    >
  >;
  groupKey: string;
  scopedTableBatchSelection: import("@/features/database-explorer/model/tableBatchSelection").TableBatchSelection;
  tableRelationNames: string[];
  setTableBatchAction: React.Dispatch<
    React.SetStateAction<{
      scopeKey: string;
      running: boolean;
      message: string;
      cancelId?: string | undefined;
      failures?:
        | import("@/features/database-explorer/model/tableBatchSelection").TableBatchFailureDetail[]
        | undefined;
      omittedFailures?: number | undefined;
    } | null>
  >;
  handleTableDoubleClick: React.ComponentProps<
    typeof ExplorerTableNavigationMenu
  >["handleTableDoubleClick"];
  tableReferencePayload: (
    tableNames: readonly string[],
  ) =>
    | import("@/features/query-editor/model/explorerTableReferenceDrop").ExplorerTableReferencePayload
    | null;
  showExplorerHoverTooltips: boolean;

  setExpandedTableKeys: React.Dispatch<React.SetStateAction<string[]>>;
  togglePinTable: (tableName: string) => void;

  findOrCreateTableTab: TabState["findOrCreateTableTab"];
  loadTablePage: TabState["loadTablePage"];
  renderSqlHistorySubmenu: React.ComponentProps<
    typeof ExplorerTableNavigationMenu
  >["renderSqlHistorySubmenu"];

  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  setActiveConnection: ConnectionState["setActiveConnection"];
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<
      import("@/services/schemaSnapshotStore").SchemaSnapshotIdentity | null
    >
  >;
  activeProjectId: string;
  addTablesToAssistant: (tableNames: readonly string[]) => Promise<void>;

  copyText: (value: string) => Promise<void>;
  handleCopyTableDdl: React.ComponentProps<
    typeof ExplorerTableNavigationMenu
  >["handleCopyTableDdl"];
  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerStateScope: string;
  objectVisibilityParentId: string;
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  objectVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  activeConnectionId: ConnectionState["activeConnectionId"];
  canBrowseTables: boolean;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  canBrowseCollections: boolean;
  loadCollections: React.ComponentProps<
    typeof ExplorerTableNavigationMenu
  >["loadCollections"];
  setTableMetadata: TabState["setTableMetadata"];
  isLoading: boolean;
  handleRenameClick: (
    table: import("@/services/tauri/types").TableInfo,
  ) => void;
  handleDdlClick: React.ComponentProps<
    typeof ExplorerTableStructureMenu
  >["handleDdlClick"];
  handleEditColumnsClick: (
    table: import("@/services/tauri/types").TableInfo,
  ) => void;
  handleTruncateClick: React.ComponentProps<
    typeof ExplorerTableStructureMenu
  >["handleTruncateClick"];
  setDatabaseMaintenanceTarget: React.ComponentProps<
    typeof ExplorerTableStructureMenu
  >["setDatabaseMaintenanceTarget"];
  handleEditViewClick: React.ComponentProps<
    typeof ExplorerTableStructureMenu
  >["handleEditViewClick"];
  handleRefreshMaterializedViewClick: React.ComponentProps<
    typeof ExplorerTableStructureMenu
  >["handleRefreshMaterializedViewClick"];
  handleTableCsvImport: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["handleTableCsvImport"];
  importTableData: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["importTableData"];
  handleTableJsonImport: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["handleTableJsonImport"];
  handleTableXlsxImport: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["handleTableXlsxImport"];
  handleImportSqlScript: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["handleImportSqlScript"];
  connections: ConnectionState["connections"];
  exportTableData: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["exportTableData"];
  activeTableExport: {
    exportId: string;
    taskId: string;
    tableName: string;
  } | null;
  cancelActiveTableExport: () => Promise<void>;
  handleOpenDataTransfer: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["handleOpenDataTransfer"];
  handleOpenDataCompare: React.ComponentProps<
    typeof ExplorerTableTransferMenu
  >["handleOpenDataCompare"];
  handleDropClick: (
    table: import("@/services/tauri/types").TableInfo,
    target?:
      | import("@/hooks/useTableOperations").TableOperationTarget
      | undefined,
  ) => Promise<void>;
  triggersByRelation: Map<
    string,
    import("@/services/tauri/types").SchemaObjectInfo[]
  >;
  viewSchemaObjectSource: (
    object: import("@/services/tauri/types").SchemaObjectInfo,
  ) => void;
}

export function createTableTreeRenderer({
  schemaObjects,
  isCurrentSchema,
  selectedTable,
  connectionId,
  navigationDatabaseName,
  schema,
  selectedExplorerNodeIds,
  driver,
  expandedTableKeys,
  activeCapabilities,
  activeDriver,
  selectedTableBatchSet,
  selectedTableBatchNames,
  tableRelations,
  objectDriver,
  createTab,
  runForSchema,
  handleTableSelect,
  explorerActivationMode,
  selectExplorerNode,
  suppressTableReferenceClickRef,
  isTableBatchSelectionActive,
  tableBatchAction,
  setTableBatchSelection,
  groupKey,
  scopedTableBatchSelection,
  tableRelationNames,
  setTableBatchAction,
  handleTableDoubleClick,
  tableReferencePayload,
  showExplorerHoverTooltips,

  setExpandedTableKeys,
  togglePinTable,

  findOrCreateTableTab,
  loadTablePage,
  renderSqlHistorySubmenu,

  objectConnection,
  setActiveConnection,
  setNamespaceError,
  setSchemaSnapshotIdentity,
  activeProjectId,
  addTablesToAssistant,

  copyText,
  handleCopyTableDdl,
  hideExplorerNodes,
  explorerStateScope,
  objectVisibilityParentId,
  showOnlyExplorerNodes,
  objectVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  activeConnectionId,
  canBrowseTables,
  loadTables,
  loadFunctions,
  canBrowseCollections,
  loadCollections,
  setTableMetadata,
  isLoading,
  handleRenameClick,
  handleDdlClick,
  handleEditColumnsClick,
  handleTruncateClick,
  setDatabaseMaintenanceTarget,
  handleEditViewClick,
  handleRefreshMaterializedViewClick,
  handleTableCsvImport,
  importTableData,
  handleTableJsonImport,
  handleTableXlsxImport,
  handleImportSqlScript,
  connections,
  exportTableData,
  activeTableExport,
  cancelActiveTableExport,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  handleDropClick,
  triggersByRelation,
  viewSchemaObjectSource,
}: CreateTableTreeRendererContext) {
  const renderTableItem = (table: TableInfo) => {
    const isPinned = schemaObjects.pinnedTables.includes(table.name);
    const isView = isViewObject(table.type);
    const isMaterializedView = isMaterializedViewObject(table.type);
    const isReadOnlyRelation = isReadOnlyRelationObject(table.type);
    const isSelectedTable = isCurrentSchema && selectedTable === table.name;
    const relationExplorerKind = isMaterializedView
      ? "materialized-view"
      : isView
        ? "view"
        : "table";
    const relationExplorerNodeId = explorerNodeId(
      relationExplorerKind,
      connectionId,
      navigationDatabaseName,
      schema,
      table.name,
    );
    const isExplorerRelationSelected = selectedExplorerNodeIds.includes(
      relationExplorerNodeId,
    );
    const relationTreeKey = tableTreeKey(
      connectionId,
      driver,
      navigationDatabaseName,
      schema,
      table.name,
    );
    const isTableExpanded = expandedTableKeys.includes(relationTreeKey);
    // A pinned external package may expose a narrower object
    // contract than the globally active version of the same
    // driver. The active connection has already resolved its
    // own runtime capability snapshot above; never replace it
    // with the global default while rendering its table actions.
    const relationCapabilities = isCurrentSchema
      ? activeCapabilities
      : defaultDatabaseCapabilities(driver || activeDriver);
    const relationOperationTarget: TableOperationTarget = {
      connectionId,
      schema,
      driver: (driver || activeDriver) as DatabaseDriver,
    };
    // The table editor already consumes this signed capability
    // list. Keep the Explorer's quicker context-menu route on
    // the same contract: an unreviewed sidecar must not show a
    // download action that the host will later reject.
    const supportsRelationExport = (
      format:
        | "csv"
        | "json"
        | "jsonl"
        | "markdown"
        | "sql"
        | "tsv"
        | "xlsx"
        | "parquet"
        | "arrow",
    ) => relationCapabilities.tableExportFormats?.includes(format) === true;
    const canImportRelationRows =
      !isReadOnlyRelation && relationCapabilities.supportsTableRowMutation;
    const contextualTableNames =
      selectedTableBatchSet.has(table.name) &&
      selectedTableBatchNames.length > 0
        ? selectedTableBatchNames
        : [table.name];
    const relationNodeIdsForAction = contextualTableNames.map((tableName) => {
      const candidate = tableRelations.find(
        (relation) => relation.name === tableName,
      );
      const candidateKind = candidate
        ? isMaterializedViewObject(candidate.type)
          ? "materialized-view"
          : isViewObject(candidate.type)
            ? "view"
            : "table"
        : "table";
      return explorerNodeId(
        candidateKind,
        connectionId,
        navigationDatabaseName,
        schema,
        tableName,
      );
    });
    const openGeneratedSql = (
      operation: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
    ) => {
      const sqlDriver = (objectDriver || activeDriver) as DatabaseDriver;
      const relation = qualifiedTableName(sqlDriver, schema, table.name);
      const sql =
        operation === "SELECT"
          ? previewTableQuery(sqlDriver, schema, table.name, 100)
          : operation === "INSERT"
            ? `INSERT INTO ${relation} (\n  column_name\n)\nVALUES (\n  value\n);`
            : operation === "UPDATE"
              ? `UPDATE ${relation}\nSET column_name = value\nWHERE condition;`
              : `DELETE FROM ${relation}\nWHERE condition;`;
      createTab("query", `${operation} ${table.name}`, sql, {
        connectionId,
        databaseName: navigationDatabaseName,
        schemaName: schema,
      });
    };

    return (
      <div key={`${schema}:${table.name}`}>
        <ExplorerSharedContextMenu
          nodeId={relationExplorerNodeId}
          onOpenChange={(open) => {
            if (open) {
              void runForSchema(schema, () => handleTableSelect(table.name));
            }
          }}
        >
          <ContextMenuTrigger asChild>
            <div
              role="treeitem"
              data-explorer-node-id={relationExplorerNodeId}
              data-database-object-key={databaseObjectNavigationKey({
                connectionId,
                databaseName: navigationDatabaseName,
                schemaName: schema,
                objectName: table.name,
              })}
              tabIndex={isExplorerRelationSelected ? 0 : -1}
              aria-selected={isExplorerRelationSelected}
              aria-expanded={isTableExpanded}
              aria-label={`${relationObjectLabel(table.type)} ${schema}.${table.name}. ${explorerActivationLabel(explorerActivationMode)} to open data; right-click for actions; expand for columns and indexes.`}
              className={cn(
                "group ml-4 flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-[3px] px-0.5 text-[11px] transition-colors",
                selectedTableBatchSet.has(table.name) ||
                  isSelectedTable ||
                  isExplorerRelationSelected
                  ? "wb-tree-row-selected"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]",
              )}
              onClick={(event) => {
                selectExplorerNode(
                  relationExplorerNodeId,
                  event.currentTarget === event.target ||
                    !(event.target as HTMLElement).closest(
                      "button,[role='checkbox']",
                    )
                    ? event
                    : undefined,
                );
                if (suppressTableReferenceClickRef.current) {
                  suppressTableReferenceClickRef.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (isTableBatchSelectionActive) {
                  if (tableBatchAction?.running) return;
                  setTableBatchSelection({
                    scopeKey: groupKey,
                    ...toggleTableBatchSelection(
                      scopedTableBatchSelection,
                      table.name,
                      tableRelationNames,
                      { range: event.shiftKey },
                    ),
                  });
                  return;
                }
                if (event.ctrlKey || event.metaKey || event.shiftKey) {
                  event.preventDefault();
                  setTableBatchAction(null);
                  setTableBatchSelection({
                    scopeKey: groupKey,
                    ...toggleTableBatchSelection(
                      { names: [], anchor: null },
                      table.name,
                      tableRelationNames,
                      { range: event.shiftKey },
                    ),
                  });
                  return;
                }
                if (
                  shouldActivateExplorerObject(
                    explorerActivationMode,
                    "click",
                    event.detail,
                  )
                ) {
                  void handleTableDoubleClick(
                    table,
                    schema,
                    connectionId,
                    navigationDatabaseName,
                  );
                  return;
                }
                void runForSchema(schema, () => handleTableSelect(table.name));
              }}
              onDoubleClick={() => {
                if (
                  !isTableBatchSelectionActive &&
                  shouldActivateExplorerObject(
                    explorerActivationMode,
                    "double-click",
                  )
                ) {
                  void handleTableDoubleClick(
                    table,
                    schema,
                    connectionId,
                    navigationDatabaseName,
                  );
                }
              }}
              onContextMenu={() => selectExplorerNode(relationExplorerNodeId)}
              onMouseDown={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button,[role='checkbox']")) {
                  return;
                }
                const draggedTables =
                  isTableBatchSelectionActive &&
                  selectedTableBatchSet.has(table.name)
                    ? selectedTableBatchNames
                    : [table.name];
                const payload = tableReferencePayload(draggedTables);
                if (!payload) return;
                beginExplorerTableReferenceDrag(event.nativeEvent, {
                  payload,
                  label: explorerTableReferenceDragLabel(payload),
                  onFinish: (dragged) => {
                    if (dragged) {
                      suppressTableReferenceClickRef.current = true;
                      window.setTimeout(() => {
                        suppressTableReferenceClickRef.current = false;
                      }, 0);
                    }
                  },
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveExplorerTreeFocus(
                    event.currentTarget,
                    event.key === "ArrowDown" ? 1 : -1,
                  );
                } else if (
                  event.key === "Enter" &&
                  !isTableBatchSelectionActive
                ) {
                  event.preventDefault();
                  void handleTableDoubleClick(
                    table,
                    schema,
                    connectionId,
                    navigationDatabaseName,
                  );
                }
              }}
              title={
                showExplorerHoverTooltips
                  ? `${relationObjectLabel(table.type)} · ${schema}.${table.name}\n${explorerActivationLabel(explorerActivationMode)} to open data · Ctrl/Cmd-click to select · Drag into a SQL editor · Right-click for actions`
                  : undefined
              }
            >
              {isTableBatchSelectionActive && (
                <Checkbox
                  className={checkboxClass}
                  disabled={tableBatchAction?.running}
                  checked={selectedTableBatchSet.has(table.name)}
                  aria-label={`${selectedTableBatchSet.has(table.name) ? "Deselect" : "Select"} ${table.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onCheckedChange={() =>
                    setTableBatchSelection({
                      scopeKey: groupKey,
                      ...toggleTableBatchSelection(
                        scopedTableBatchSelection,
                        table.name,
                        tableRelationNames,
                      ),
                    })
                  }
                />
              )}
              <button
                type="button"
                className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                aria-label={`${isTableExpanded ? "Collapse" : "Expand"} ${table.name} metadata`}
                aria-expanded={isTableExpanded}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedTableKeys((current) =>
                    current.includes(relationTreeKey)
                      ? current.filter((key) => key !== relationTreeKey)
                      : [...current, relationTreeKey],
                  );
                }}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                {isTableExpanded ? (
                  <ChevronDown size={10} />
                ) : (
                  <ChevronRight size={10} />
                )}
              </button>
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
                  isSelectedTable && "opacity-100",
                  isPinned && "text-primary opacity-100",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  isPinned && "font-bold text-foreground",
                )}
              >
                {table.name}
              </span>
              {table.comment?.trim() && (
                <span
                  className="max-w-[34%] shrink truncate text-[9px] font-normal text-[hsl(var(--wb-text-muted))] opacity-75"
                  title={
                    showExplorerHoverTooltips ? table.comment.trim() : undefined
                  }
                >
                  {table.comment.trim()}
                </span>
              )}
              {isMaterializedView && (
                <span className="shrink-0 text-[8px] uppercase text-indigo-300/70">
                  MV
                </span>
              )}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-4 w-4 shrink-0 transition-all duration-200",
                    isPinned
                      ? "text-primary opacity-100"
                      : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:opacity-100",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runForSchema(schema, () => togglePinTable(table.name));
                  }}
                  title={isPinned ? "Unpin Table" : "Pin Table"}
                >
                  {isPinned ? <PinOff size={10} /> : <Pin size={10} />}
                </Button>
              </div>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className={menuContentClass}>
            <ExplorerTableNavigationMenu
              relationCapabilities={relationCapabilities}
              handleTableDoubleClick={handleTableDoubleClick}
              table={table}
              schema={schema}
              connectionId={connectionId}
              navigationDatabaseName={navigationDatabaseName}
              runForSchema={runForSchema}
              findOrCreateTableTab={findOrCreateTableTab}
              loadTablePage={loadTablePage}
              openGeneratedSql={openGeneratedSql}
              renderSqlHistorySubmenu={renderSqlHistorySubmenu}
              objectConnection={objectConnection}
              setActiveConnection={setActiveConnection}
              setNamespaceError={setNamespaceError}
              setSchemaSnapshotIdentity={setSchemaSnapshotIdentity}
              activeProjectId={activeProjectId}
              addTablesToAssistant={addTablesToAssistant}
              contextualTableNames={contextualTableNames}
              copyText={copyText}
              handleCopyTableDdl={handleCopyTableDdl}
              relationOperationTarget={relationOperationTarget}
              hideExplorerNodes={hideExplorerNodes}
              explorerStateScope={explorerStateScope}
              objectVisibilityParentId={objectVisibilityParentId}
              relationNodeIdsForAction={relationNodeIdsForAction}
              showOnlyExplorerNodes={showOnlyExplorerNodes}
              objectVisibilityFilter={objectVisibilityFilter}
              clearExplorerVisibilityFilter={clearExplorerVisibilityFilter}
              openExplorerVisibilityFilter={openExplorerVisibilityFilter}
              activeConnectionId={activeConnectionId}
              canBrowseTables={canBrowseTables}
              loadTables={loadTables}
              activeCapabilities={activeCapabilities}
              loadFunctions={loadFunctions}
              canBrowseCollections={canBrowseCollections}
              loadCollections={loadCollections}
              activeDriver={activeDriver}
              setTableMetadata={setTableMetadata}
              isLoading={isLoading}
              handleRenameClick={handleRenameClick}
            />

            <ExplorerTableStructureMenu
              connectionId={connectionId}
              runForSchema={runForSchema}
              schema={schema}
              handleDdlClick={handleDdlClick}
              table={table}
              relationOperationTarget={relationOperationTarget}
              openGeneratedSql={openGeneratedSql}
              isReadOnlyRelation={isReadOnlyRelation}
              togglePinTable={togglePinTable}
              isPinned={isPinned}
              handleEditColumnsClick={handleEditColumnsClick}
              relationCapabilities={relationCapabilities}
              handleTruncateClick={handleTruncateClick}
              objectConnection={objectConnection}
              setDatabaseMaintenanceTarget={setDatabaseMaintenanceTarget}
              navigationDatabaseName={navigationDatabaseName}
              objectDriver={objectDriver}
              isView={isView}
              isMaterializedView={isMaterializedView}
              handleEditViewClick={handleEditViewClick}
              handleRefreshMaterializedViewClick={
                handleRefreshMaterializedViewClick
              }
            />

            <ExplorerTableTransferMenu
              canImportRelationRows={canImportRelationRows}
              runForSchema={runForSchema}
              schema={schema}
              handleTableCsvImport={handleTableCsvImport}
              table={table}
              connectionId={connectionId}
              navigationDatabaseName={navigationDatabaseName}
              importTableData={importTableData}
              relationOperationTarget={relationOperationTarget}
              handleTableJsonImport={handleTableJsonImport}
              handleTableXlsxImport={handleTableXlsxImport}
              relationCapabilities={relationCapabilities}
              handleImportSqlScript={handleImportSqlScript}
              driver={driver}
              connections={connections}
              supportsRelationExport={supportsRelationExport}
              exportTableData={exportTableData}
              activeTableExport={activeTableExport}
              cancelActiveTableExport={cancelActiveTableExport}
              isView={isView}
              objectConnection={objectConnection}
              handleOpenDataTransfer={handleOpenDataTransfer}
              handleOpenDataCompare={handleOpenDataCompare}
            />

            <ContextMenuSeparator className={menuSeparatorClass} />
            <ContextMenuItem
              disabled={!relationCapabilities.supportsTableDdl}
              onClick={() =>
                void runForSchema(schema, () =>
                  handleDropClick(table, relationOperationTarget),
                )
              }
              className={cn(menuItemClass, "text-destructive")}
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Drop {relationObjectLabel(table.type)}...
            </ContextMenuItem>
          </ContextMenuContent>
        </ExplorerSharedContextMenu>
        {isTableExpanded && (
          <TableObjectTree
            identity={{
              projectId: activeProjectId,
              connectionId,
              driver: driver || activeDriver,
              databaseName: navigationDatabaseName || undefined,
              schema,
              table: table.name,
            }}
            includeIndexes={relationCapabilities.supportsTableIndexes}
            includeConstraints={relationCapabilities.supportsTableConstraints}
            triggers={
              triggersByRelation.get(table.name.toLocaleLowerCase()) || []
            }
            onTriggerOpen={viewSchemaObjectSource}
            onReferenceSelect={({
              schema: referencedSchema,
              table: referencedTable,
            }) =>
              void handleTableDoubleClick(
                { name: referencedTable },
                referencedSchema,
                connectionId,
                navigationDatabaseName,
              )
            }
          />
        )}
      </div>
    );
  };

  return { renderTableItem };
}
