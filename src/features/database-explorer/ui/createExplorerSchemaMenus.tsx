import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PostgresDatabaseVisibilitySection } from "@/components/workspace/PostgresDatabaseVisibilitySection";
import {
  connectionTreeColor,
  objectGroupKey,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import type { ExplorerTableBatchSelection } from "@/features/database-explorer/model/explorerSidebarTypes";
import type { TableBatchFailureDetail } from "@/features/database-explorer/model/tableBatchSelection";
import { EXPLORER_SIDEBAR_CHECKBOX_CLASS as checkboxClass } from "@/features/database-explorer/ui/explorerStyles";
import { cn } from "@/lib/utils";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types/database";
import {
  Code2,
  Database,
  ListChecks,
  Plus,
  RefreshCw,
  TableProperties,
} from "lucide-react";

interface CreateExplorerSchemaMenusContext {
  canBrowseDatabaseCatalogs: boolean;
  activeConnectionId: string | null;
  schemas: string[];
  postgresDatabaseRows: string[];
  preferredVisibleSchema: string | null;
  showAllSchemas: boolean;
  visibleSchemaSet: Set<string>;
  schemaPickerOpen: boolean;
  setSchemaPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  namespaceLabelPlural: string;
  postgresDatabaseCountLabel: string;
  schemaCountLabel: string;
  handleRefresh: () => Promise<void>;
  isLoading: boolean;
  activePostgresDatabase: string;
  showAllPostgresDatabases: boolean;
  visiblePostgresDatabaseSet: Set<string>;
  activeDriver: DatabaseDriver;
  handleToggleAllPostgresDatabases: (
    checked: boolean | "indeterminate",
  ) => void;
  handleTogglePostgresDatabaseVisibility: (
    database: string,
    checked: boolean | "indeterminate",
  ) => void;
  handleToggleAllSchemas: (checked: boolean | "indeterminate") => void;
  handleToggleSchemaVisibility: (
    schema: string,
    checked: boolean | "indeterminate",
  ) => void;
  namespaceLabel: string;
  currentSchema: string | null;
  canBrowseTables: boolean;
  tableBatchSelection: ExplorerTableBatchSelection | null;
  handleCreateTable: () => void;
  handleCreateView: () => void;
  activeCapabilities: DatabaseCapabilities;
  handleCreateMaterializedView: () => void;
  setTableBatchAction: React.Dispatch<
    React.SetStateAction<{
      scopeKey: string;
      running: boolean;
      message: string;
      cancelId?: string | undefined;
      failures?: TableBatchFailureDetail[] | undefined;
      omittedFailures?: number | undefined;
    } | null>
  >;
  setTableBatchSelection: React.Dispatch<
    React.SetStateAction<ExplorerTableBatchSelection | null>
  >;
  canBrowseCollections: boolean;
  collectionLabelPlural: string;
  isCollectionsLoading: boolean;
  handleCreateCollectionClick: () => void;
  collectionLabel: string;
}

export function createExplorerSchemaMenus({
  canBrowseDatabaseCatalogs,
  activeConnectionId,
  schemas,
  postgresDatabaseRows,
  preferredVisibleSchema,
  showAllSchemas,
  visibleSchemaSet,
  schemaPickerOpen,
  setSchemaPickerOpen,
  namespaceLabelPlural,
  postgresDatabaseCountLabel,
  schemaCountLabel,
  handleRefresh,
  isLoading,
  activePostgresDatabase,
  showAllPostgresDatabases,
  visiblePostgresDatabaseSet,
  activeDriver,
  handleToggleAllPostgresDatabases,
  handleTogglePostgresDatabaseVisibility,
  handleToggleAllSchemas,
  handleToggleSchemaVisibility,
  namespaceLabel,
  currentSchema,
  canBrowseTables,
  tableBatchSelection,
  handleCreateTable,
  handleCreateView,
  activeCapabilities,
  handleCreateMaterializedView,
  setTableBatchAction,
  setTableBatchSelection,
  canBrowseCollections,
  collectionLabelPlural,
  isCollectionsLoading,
  handleCreateCollectionClick,
  collectionLabel,
}: CreateExplorerSchemaMenusContext) {
  const renderSchemaVisibilityPicker = () => {
    const isPostgresPicker = canBrowseDatabaseCatalogs;
    if (
      !activeConnectionId ||
      (schemas.length === 0 &&
        (!isPostgresPicker || postgresDatabaseRows.length === 0))
    ) {
      return null;
    }

    const defaultSchemaName = preferredVisibleSchema;
    const pickerSchemas = defaultSchemaName
      ? schemas.filter((schema) => schema !== defaultSchemaName)
      : schemas;
    const schemaIsChecked = (schema: string) =>
      showAllSchemas || visibleSchemaSet.has(schema);

    return (
      <Popover open={schemaPickerOpen} onOpenChange={setSchemaPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-panel-raised))] px-1 text-[10px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
            title={
              isPostgresPicker
                ? "Select visible databases"
                : `Select visible ${namespaceLabelPlural}`
            }
            onClick={(event) => event.stopPropagation()}
          >
            {isPostgresPicker ? postgresDatabaseCountLabel : schemaCountLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="right"
          sideOffset={6}
          className="w-[292px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.38)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex h-8 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-2">
            <span className="text-[11px] font-semibold">
              {isPostgresPicker
                ? "Select databases"
                : `Select ${namespaceLabelPlural}`}
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="wb-icon-button h-5 w-5"
                onClick={() => void handleRefresh()}
                title="Refresh"
                disabled={isLoading}
              >
                <RefreshCw
                  size={11}
                  className={cn(isLoading && "animate-spin")}
                />
              </button>
            </div>
          </div>
          <div className="max-h-[430px] overflow-auto py-1 custom-scrollbar">
            {isPostgresPicker && (
              <PostgresDatabaseVisibilitySection
                databases={postgresDatabaseRows}
                currentDatabase={activePostgresDatabase}
                showAll={showAllPostgresDatabases}
                visibleDatabases={visiblePostgresDatabaseSet}
                checkboxClassName={checkboxClass}
                connectionColor={connectionTreeColor(activeDriver)}
                onToggleAll={handleToggleAllPostgresDatabases}
                onToggleDatabase={handleTogglePostgresDatabaseVisibility}
              />
            )}
            {!isPostgresPicker && (
              <>
                <label className="flex h-6 cursor-default select-none items-center gap-2 px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
                  <Checkbox
                    className={checkboxClass}
                    checked={showAllSchemas}
                    onCheckedChange={handleToggleAllSchemas}
                  />
                  <span className="font-medium">
                    All {namespaceLabelPlural}
                  </span>
                  <span className="ml-auto text-[10px] wb-muted">
                    add pattern
                  </span>
                </label>

                {defaultSchemaName && (
                  <label className="flex h-6 cursor-default select-none items-center gap-2 px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
                    <Checkbox
                      className={checkboxClass}
                      checked={schemaIsChecked(defaultSchemaName)}
                      onCheckedChange={(checked) =>
                        handleToggleSchemaVisibility(defaultSchemaName, checked)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">
                      Default {namespaceLabel}{" "}
                      <span className="wb-muted">({defaultSchemaName})</span>
                    </span>
                  </label>
                )}

                {pickerSchemas.map((schema) => (
                  <label
                    key={schema}
                    className="flex h-6 cursor-default select-none items-center gap-2 px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]"
                  >
                    <Checkbox
                      className={checkboxClass}
                      checked={schemaIsChecked(schema)}
                      onCheckedChange={(checked) =>
                        handleToggleSchemaVisibility(schema, checked)
                      }
                    />
                    <Database
                      size={12}
                      className="shrink-0"
                      style={{ color: connectionTreeColor(activeDriver) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{schema}</span>
                  </label>
                ))}
              </>
            )}
          </div>
          <div className="border-t border-[hsl(var(--wb-border-subtle))] px-2 py-1 text-[10px] wb-muted">
            Press Enter or click outside the list to apply
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const renderObjectActions = () => {
    if (currentSchema && canBrowseTables) {
      const selectionScopeKey = activeConnectionId
        ? objectGroupKey(
            activeConnectionId,
            activeDriver,
            currentSchema,
            "objects",
          )
        : null;
      const selectionModeActive =
        selectionScopeKey !== null &&
        tableBatchSelection?.scopeKey === selectionScopeKey;
      return (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-5 w-5"
            onClick={handleRefresh}
            title="Refresh Tables"
            disabled={isLoading}
          >
            <RefreshCw size={10} className={cn(isLoading && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-5 w-5"
            onClick={handleCreateTable}
            title="Create New Table"
            disabled={!currentSchema || !canBrowseTables}
          >
            <Plus size={10} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-5 w-5"
            onClick={handleCreateView}
            title="Create New View"
            disabled={!currentSchema || !activeCapabilities.supportsViews}
          >
            <Code2 size={10} />
          </Button>
          {activeCapabilities.supportsMaterializedViews && (
            <Button
              variant="ghost"
              size="icon"
              className="wb-icon-button h-5 w-5"
              onClick={handleCreateMaterializedView}
              title="Create New Materialized View"
              disabled={!currentSchema}
            >
              <TableProperties size={10} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "wb-icon-button h-5 w-5",
              selectionModeActive && "wb-tree-row-selected",
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (!selectionScopeKey) return;
              setTableBatchAction(null);
              setTableBatchSelection((current) =>
                current?.scopeKey === selectionScopeKey
                  ? null
                  : { scopeKey: selectionScopeKey, names: [], anchor: null },
              );
            }}
            title={
              selectionModeActive
                ? "Exit table selection"
                : "Select tables for batch actions"
            }
            aria-pressed={selectionModeActive}
          >
            <ListChecks size={10} />
          </Button>
        </div>
      );
    }

    if (!canBrowseTables && canBrowseCollections) {
      return (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-5 w-5"
            onClick={handleRefresh}
            title={`Refresh ${collectionLabelPlural}`}
            disabled={isCollectionsLoading}
          >
            <RefreshCw
              size={10}
              className={cn(isCollectionsLoading && "animate-spin")}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-5 w-5"
            onClick={handleCreateCollectionClick}
            title={`Create New ${collectionLabel}`}
            disabled={!activeConnectionId}
          >
            <Plus size={10} />
          </Button>
        </div>
      );
    }

    return null;
  };

  return { renderSchemaVisibilityPicker, renderObjectActions };
}
