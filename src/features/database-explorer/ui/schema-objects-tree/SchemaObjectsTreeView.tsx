import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { tableTreeKey } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import {
  MAX_EXPLORER_TABLE_BATCH_SELECTION,
  toggleAllVisibleTableBatchSelection,
} from "@/features/database-explorer/model/tableBatchSelection";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { MetadataNodeBadge } from "@/features/database-explorer/ui/ExplorerStatusBadges";
import {
  EXPLORER_SIDEBAR_CHECKBOX_CLASS as checkboxClass,
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { ExplorerTreeStateRow } from "@/features/database-explorer/ui/ExplorerTreeStateRow";
import { ExplorerSegmentedVirtualList } from "@/features/database-explorer/ui/ExplorerVirtualList";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { databaseSchemaNavigationKey } from "@/lib/databaseNavigation";
import { buildRedisKeyTree } from "@/lib/redisKey";
import { cn } from "@/lib/utils";
import {
  MAX_REDIS_KEYS_IN_MEMORY,
  REDIS_KEY_PAGE_SIZE,
} from "@/store/useSchemaStore";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  KeyRound,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  SearchCode,
  Sparkles,
  Table,
  TableProperties,
  X,
} from "lucide-react";

import type { DatabaseDriver } from "@/services/tauri/types/database";
import type { SchemaObjectsTreeContext } from "./types";

export function SchemaObjectsTreeView({
  setIsTablesHovered,
  connectionId,
  navigationDatabaseName,
  schema,
  setExpandedObjectGroupKeys,
  groupKey,
  isObjectGroupExpanded,
  activeCapabilities,
  objectSectionLabel,
  hasSchemaObjectContext,
  schemaObjectCountLabel,
  schemaNodeState,
  isCurrentSchema,
  isTablesHovered,
  renderObjectActions,
  canBrowseTables,
  runForSchema,
  createTableTab,
  canBrowseCollections,
  handleCreateCollectionClick,
  collectionLabel,
  copyText,
  openObjectBrowser,
  objectConnection,
  openScopedQueryConsole,
  renderSqlHistorySubmenu,
  tableRelationNames,
  addTablesToAssistant,
  isLoading,
  isCollectionsLoading,
  handleRefreshSchema,
  tableRelations,
  setTableBatchSelection,
  filterText,
  setFilterText,
  isTableBatchSelectionActive,
  tableBatchAction,
  allVisibleTablesSelected,
  selectedTableBatchNames,
  scopedTableBatchSelection,
  refreshSelectedTableMetadata,
  driver,
  activeDriver,
  copySelectedTableNames,
  showSelectedTableDdl,
  schemaDiagramLoadingKey,
  handleOpenSchemaDiagram,
  activeProjectId,
  objectDriver,
  exportSelectedTablesSql,
  handleOpenDataTransfer,
  handleOpenDataCompare,
  cancelSelectedTableExport,
  setTableBatchAction,
  namespaceLabel,
  schemaObjects,
  collectionLabelPlural,
  collectionNextCursor,
  objectVisibilityFilter,
  clearExplorerVisibilityFilter,
  explorerStateScope,
  objectVisibilityParentId,
  renderLoadMoreKeys,
  renderRedisKeyNodes,
  explorerTreeRowHeight,
  renderCollectionItem,
  expandedTableKeys,
  isSchemaObjectsLoading,
  renderTableItem,
  renderVirtualViews,
  renderRoutines,
  renderSchemaObjectDescriptors,
}: SchemaObjectsTreeContext) {
  return (
    <ExplorerContextMenuHost>
      <div
        className="wb-explorer-children"
        onMouseEnter={() => setIsTablesHovered(true)}
        onMouseLeave={() => setIsTablesHovered(false)}
      >
        <ExplorerSharedContextMenu
          nodeId={explorerNodeId(
            "group",
            connectionId,
            navigationDatabaseName,
            schema,
            "objects",
          )}
        >
          <ContextMenuTrigger asChild>
            <button
              type="button"
              data-database-schema-key={databaseSchemaNavigationKey({
                connectionId,
                databaseName: navigationDatabaseName,
                schemaName: schema,
              })}
              className="flex h-7 w-full items-center justify-between rounded-[3px] pr-1 text-left hover:bg-[hsl(var(--wb-hover))]"
              onClick={() => {
                setExpandedObjectGroupKeys((current) =>
                  current.includes(groupKey)
                    ? current.filter((item) => item !== groupKey)
                    : [...current, groupKey],
                );
              }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                {isObjectGroupExpanded ? (
                  <ChevronDown size={12} className="shrink-0 wb-muted" />
                ) : (
                  <ChevronRight size={12} className="shrink-0 wb-muted" />
                )}
                {activeCapabilities.dataModel === "keyValue" ? (
                  <KeyRound
                    size={12}
                    className={cn("shrink-0", explorerObjectIconClass("key"))}
                  />
                ) : activeCapabilities.dataModel === "document" ? (
                  <Boxes
                    size={12}
                    className={cn(
                      "shrink-0",
                      explorerObjectIconClass("collection"),
                    )}
                  />
                ) : activeCapabilities.dataModel === "search" ? (
                  <SearchCode
                    size={12}
                    className={cn(
                      "shrink-0",
                      explorerObjectIconClass("search-index"),
                    )}
                  />
                ) : (
                  <Table
                    size={12}
                    className={cn("shrink-0", explorerObjectIconClass("table"))}
                  />
                )}
                <span className="truncate text-[11px] font-medium text-[hsl(var(--wb-text))]">
                  {objectSectionLabel}
                </span>
                {hasSchemaObjectContext && (
                  <span
                    className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1 text-[9px] wb-muted"
                    title={
                      activeCapabilities.dataModel === "keyValue"
                        ? `Loads ${REDIS_KEY_PAGE_SIZE} keys per page and keeps up to ${MAX_REDIS_KEYS_IN_MEMORY} keys in memory`
                        : undefined
                    }
                  >
                    {schemaObjectCountLabel}
                  </span>
                )}
                <MetadataNodeBadge state={schemaNodeState} />
              </div>
              {isCurrentSchema && isTablesHovered && renderObjectActions()}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent className={menuContentClass}>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={menuSubClass}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                New
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className={menuContentClass}>
                {canBrowseTables && (
                  <>
                    <ContextMenuItem
                      className={menuItemClass}
                      disabled={!activeCapabilities.supportsTableDdl}
                      onClick={() =>
                        void runForSchema(schema, () => {
                          createTableTab(connectionId, schema);
                        })
                      }
                    >
                      Table
                    </ContextMenuItem>
                  </>
                )}
                {canBrowseCollections && (
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() =>
                      void runForSchema(schema, handleCreateCollectionClick)
                    }
                  >
                    {collectionLabel}
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem
              className={menuItemClass}
              onClick={() => void copyText(objectSectionLabel)}
            >
              <Clipboard className="mr-2 h-3.5 w-3.5" />
              Copy Name
            </ContextMenuItem>
            <ContextMenuSeparator className={menuSeparatorClass} />
            {canBrowseTables && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  openObjectBrowser(
                    connectionId,
                    objectConnection?.name || "Database",
                    navigationDatabaseName,
                    schema,
                  )
                }
              >
                <TableProperties className="mr-2 h-3.5 w-3.5" />
                Open Object Browser
              </ContextMenuItem>
            )}
            <ContextMenuItem
              className={menuItemClass}
              disabled={!activeCapabilities.supportsSqlQuery}
              onClick={openScopedQueryConsole}
            >
              <Code2 className="mr-2 h-3.5 w-3.5" />
              New Query Console
            </ContextMenuItem>
            {activeCapabilities.supportsSqlQuery &&
              renderSqlHistorySubmenu({
                connectionId,
                databaseName: navigationDatabaseName,
                schemaName: schema,
              })}
            {tableRelationNames.length > 0 && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() => void addTablesToAssistant(tableRelationNames)}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                Add Tables to AI Context
              </ContextMenuItem>
            )}
            <ContextMenuSeparator className={menuSeparatorClass} />
            <ContextMenuItem
              className={menuItemClass}
              disabled={isLoading || isCollectionsLoading}
              onClick={() => void handleRefreshSchema(connectionId, schema)}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Load All / Refresh
              <ContextMenuShortcut>⌘R</ContextMenuShortcut>
            </ContextMenuItem>
            {canBrowseTables && tableRelations.length > 0 && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  setTableBatchSelection({
                    scopeKey: groupKey,
                    names: [],
                    anchor: null,
                  })
                }
              >
                <ListChecks className="mr-2 h-3.5 w-3.5" />
                Select Multiple Tables
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ExplorerSharedContextMenu>

        {isObjectGroupExpanded && (
          <>
            {schemaNodeState?.status === "error" && (
              <ExplorerTreeStateRow
                state="error"
                title={
                  schemaNodeState.message ||
                  "Schema metadata could not be loaded"
                }
                onRetry={() => void handleRefreshSchema(connectionId, schema)}
                retryAriaLabel={`Retry loading objects in ${schema}`}
              >
                {schemaNodeState.message || "Objects unavailable"}
              </ExplorerTreeStateRow>
            )}
            {activeCapabilities.dataModel === "keyValue" && isCurrentSchema && (
              <div className="relative mx-1 mb-1 mt-0.5">
                <Search
                  size={12}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted"
                />
                <input
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                  placeholder="Filter Redis keys"
                  aria-label="Filter Redis keys"
                  spellCheck={false}
                  className="h-7 w-full rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] pl-7 pr-7 text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
                />
                {filterText && (
                  <button
                    type="button"
                    onClick={() => setFilterText("")}
                    aria-label="Clear Redis key filter"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 wb-muted hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            )}
            {isTableBatchSelectionActive && tableRelations.length > 0 && (
              <div className="mx-1 mb-1 mt-0.5 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] text-[10px]">
                <div className="flex min-h-7 flex-wrap items-center gap-1 px-1.5 py-1">
                  <Checkbox
                    className={checkboxClass}
                    disabled={tableBatchAction?.running}
                    checked={
                      allVisibleTablesSelected
                        ? true
                        : selectedTableBatchNames.length > 0
                          ? "indeterminate"
                          : false
                    }
                    aria-label={
                      allVisibleTablesSelected
                        ? "Deselect all visible tables"
                        : "Select all visible tables"
                    }
                    onCheckedChange={() =>
                      setTableBatchSelection({
                        scopeKey: groupKey,
                        ...toggleAllVisibleTableBatchSelection(
                          scopedTableBatchSelection,
                          tableRelationNames,
                        ),
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate wb-muted">
                    {selectedTableBatchNames.length > 0
                      ? `${selectedTableBatchNames.length} selected`
                      : `Select up to ${MAX_EXPLORER_TABLE_BATCH_SELECTION}`}
                    {tableBatchAction?.scopeKey === groupKey
                      ? ` · ${tableBatchAction.message}`
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      tableBatchAction?.running
                    }
                    onClick={() =>
                      void refreshSelectedTableMetadata({
                        scopeKey: groupKey,
                        connectionId,
                        driver: (driver || activeDriver) as DatabaseDriver,
                        driverPackageVersion:
                          objectConnection?.driverPackageVersion,
                        connectionDatabaseName: objectConnection?.database,
                        databaseName: navigationDatabaseName,
                        schema,
                        tables: selectedTableBatchNames,
                      })
                    }
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      tableBatchAction?.running
                    }
                    title="Copy selected table names"
                    onClick={() =>
                      void copySelectedTableNames({
                        scopeKey: groupKey,
                        tables: selectedTableBatchNames,
                      })
                    }
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      !objectConnection ||
                      tableBatchAction?.running
                    }
                    title="Add selected tables to Assistant context"
                    onClick={() =>
                      void addTablesToAssistant(selectedTableBatchNames)
                    }
                  >
                    AI
                  </button>
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      !objectConnection ||
                      tableBatchAction?.running
                    }
                    title="Load the selected tables into one DDL viewer"
                    onClick={() => {
                      if (!objectConnection) return;
                      const selectedNames = new Set(selectedTableBatchNames);
                      void showSelectedTableDdl({
                        scopeKey: groupKey,
                        connectionId,
                        driver: objectConnection.driver,
                        driverPackageVersion:
                          objectConnection.driverPackageVersion,
                        connectionDatabaseName: objectConnection.database,
                        databaseName: navigationDatabaseName,
                        schema,
                        tables: tableRelations.filter((table) =>
                          selectedNames.has(table.name),
                        ),
                      });
                    }}
                  >
                    DDL
                  </button>
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      !objectConnection ||
                      tableBatchAction?.running ||
                      Boolean(schemaDiagramLoadingKey)
                    }
                    title="Open a schema diagram with the selected tables highlighted"
                    onClick={() => {
                      if (!objectConnection) return;
                      void handleOpenSchemaDiagram(
                        {
                          projectId: activeProjectId,
                          connectionId,
                          connectionName: objectConnection.name,
                          driver: objectConnection.driver,
                          databaseName: navigationDatabaseName,
                          schemaName: schema,
                        },
                        selectedTableBatchNames,
                      );
                    }}
                  >
                    Diagram
                  </button>
                  {objectDriver &&
                    normalizeDatabaseDriverName(objectDriver) === "postgres" &&
                    !objectConnection?.driverPackageVersion &&
                    activeCapabilities.tableExportFormats?.includes("sql") && (
                      <button
                        type="button"
                        className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                        disabled={
                          selectedTableBatchNames.length === 0 ||
                          tableBatchAction?.running
                        }
                        title="Export the selected tables as one data-only SQL file"
                        onClick={() =>
                          void exportSelectedTablesSql({
                            scopeKey: groupKey,
                            connectionId,
                            driver: objectDriver,
                            schema,
                            tables: selectedTableBatchNames,
                          })
                        }
                      >
                        SQL
                      </button>
                    )}
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      !objectConnection ||
                      tableBatchAction?.running ||
                      !activeCapabilities.supportsTableDataTransfer
                    }
                    onClick={() => {
                      if (!objectConnection) return;
                      void handleOpenDataTransfer({
                        connection: objectConnection,
                        database: navigationDatabaseName,
                        schema,
                        table: selectedTableBatchNames[0],
                        tables: selectedTableBatchNames,
                        scope:
                          selectedTableBatchNames.length > 1
                            ? "schema"
                            : "table",
                      });
                    }}
                  >
                    Transfer
                  </button>
                  <button
                    type="button"
                    className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] disabled:opacity-40"
                    disabled={
                      selectedTableBatchNames.length === 0 ||
                      !objectConnection ||
                      tableBatchAction?.running
                    }
                    onClick={() => {
                      if (!objectConnection) return;
                      void handleOpenDataCompare({
                        connection: objectConnection,
                        database: navigationDatabaseName,
                        schema,
                        tables: selectedTableBatchNames,
                      });
                    }}
                  >
                    Compare
                  </button>
                  {tableBatchAction?.scopeKey === groupKey &&
                    tableBatchAction.running &&
                    tableBatchAction.cancelId && (
                      <button
                        type="button"
                        className="rounded-[3px] px-1.5 py-0.5 text-[10px] text-[hsl(var(--wb-warning))] hover:bg-[hsl(var(--wb-hover))]"
                        onClick={() => void cancelSelectedTableExport()}
                      >
                        Cancel
                      </button>
                    )}
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                    aria-label="Exit table selection"
                    disabled={tableBatchAction?.running}
                    onClick={() => {
                      setTableBatchSelection(null);
                      setTableBatchAction(null);
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
                {tableBatchAction?.scopeKey === groupKey &&
                !tableBatchAction.running &&
                tableBatchAction.failures?.length ? (
                  <details className="border-t border-[hsl(var(--wb-border-subtle))] px-1.5 py-1">
                    <summary className="cursor-pointer select-none text-[hsl(var(--wb-warning))] outline-none focus-visible:underline">
                      Show refresh failure details
                    </summary>
                    <ul className="mt-1 max-h-32 space-y-1 overflow-auto pl-3.5">
                      {tableBatchAction.failures.map((failure) => (
                        <li key={failure.name} className="list-disc">
                          <span className="font-medium text-[hsl(var(--wb-text))]">
                            {failure.name}
                          </span>
                          <span className="wb-muted">
                            {" · "}
                            {failure.message}
                          </span>
                        </li>
                      ))}
                      {Boolean(tableBatchAction.omittedFailures) && (
                        <li className="list-disc wb-muted">
                          {tableBatchAction.omittedFailures} more failures are
                          omitted
                        </li>
                      )}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
            {!hasSchemaObjectContext ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                Select a {namespaceLabel} to view objects
              </div>
            ) : canBrowseCollections ? (
              isCurrentSchema &&
              isCollectionsLoading &&
              schemaObjects.collections.length === 0 ? (
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] italic wb-muted">
                  <RefreshCw size={11} className="animate-spin" />
                  Loading {collectionLabelPlural.toLowerCase()}...
                </div>
              ) : schemaObjects.collections.length === 0 &&
                schemaNodeState?.status === "error" ? null : schemaObjects
                  .collections.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] wb-muted">
                  <div className="italic">
                    {collectionNextCursor
                      ? filterText
                        ? "No matching keys in this scan page"
                        : "No keys in this scan page"
                      : filterText
                        ? `No ${collectionLabelPlural.toLowerCase()} match "${filterText}"`
                        : objectVisibilityFilter
                          ? `All ${collectionLabelPlural.toLowerCase()} are hidden by the active filter`
                          : `No ${collectionLabelPlural.toLowerCase()} found`}
                  </div>
                  {objectVisibilityFilter && (
                    <button
                      type="button"
                      className="mt-1 text-[10px] text-[hsl(var(--wb-accent))] hover:underline"
                      onClick={() =>
                        clearExplorerVisibilityFilter(
                          explorerStateScope,
                          objectVisibilityParentId,
                        )
                      }
                    >
                      Clear filter
                    </button>
                  )}
                  {renderLoadMoreKeys()}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {activeCapabilities.dataModel === "keyValue" ? (
                    <ExplorerContextMenuHost>
                      <div>
                        {renderRedisKeyNodes(
                          buildRedisKeyTree(schemaObjects.collections),
                        )}
                      </div>
                    </ExplorerContextMenuHost>
                  ) : (
                    <ExplorerContextMenuHost>
                      <ExplorerSegmentedVirtualList
                        items={schemaObjects.collections}
                        rowHeight={explorerTreeRowHeight}
                        getKey={(collection) => collection.name}
                        renderItem={(collection) =>
                          renderCollectionItem(collection)
                        }
                        isExpanded={(collection) =>
                          expandedTableKeys.includes(
                            tableTreeKey(
                              connectionId,
                              driver,
                              navigationDatabaseName,
                              schema,
                              collection.name,
                            ),
                          )
                        }
                      />
                    </ExplorerContextMenuHost>
                  )}
                  {renderLoadMoreKeys()}
                </div>
              )
            ) : !canBrowseTables ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                Object browsing is not supported by this driver
              </div>
            ) : isSchemaObjectsLoading && schemaObjects.tables.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                Loading tables...
              </div>
            ) : tableRelations.length === 0 &&
              schemaNodeState?.status ===
                "error" ? null : tableRelations.length === 0 ? (
              <div className="flex min-h-7 items-center gap-1 px-2 py-1.5 text-[11px] italic wb-muted">
                <span>
                  {filterText
                    ? `No tables match "${filterText}"`
                    : objectVisibilityFilter
                      ? "All tables are hidden by the active filter"
                      : "No tables found"}
                </span>
                {objectVisibilityFilter && (
                  <button
                    type="button"
                    className="ml-auto shrink-0 not-italic text-[10px] text-[hsl(var(--wb-accent))] hover:underline"
                    onClick={() =>
                      clearExplorerVisibilityFilter(
                        explorerStateScope,
                        objectVisibilityParentId,
                      )
                    }
                  >
                    Clear filter
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                <ExplorerContextMenuHost>
                  <ExplorerSegmentedVirtualList
                    items={tableRelations}
                    rowHeight={explorerTreeRowHeight}
                    getKey={(table) => table.name}
                    isExpanded={(table) =>
                      expandedTableKeys.includes(
                        tableTreeKey(
                          connectionId,
                          driver,
                          navigationDatabaseName,
                          schema,
                          table.name,
                        ),
                      )
                    }
                    renderItem={renderTableItem}
                  />
                </ExplorerContextMenuHost>
              </div>
            )}
          </>
        )}
        {renderVirtualViews()}
        {renderRoutines()}
        {renderSchemaObjectDescriptors()}
      </div>
    </ExplorerContextMenuHost>
  );
}
