import { cn } from "@/lib/utils";
import {
  Database,
  Table,
  Braces,
  Search,
  RefreshCw,
  Plus,
  Pin,
  PinOff,
  Eraser,
  Pencil,
  Download,
  TableProperties,
  Code2,
  Trash2,
  Clipboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { CreateDatabaseDialog } from "./CreateDatabaseDialog";
import { RenameTableDialog } from "./RenameTableDialog";
import { DdlViewerDialog } from "./DdlViewerDialog";
import { EditColumnsDialog } from "./EditColumnsDialog";
import { CreateViewDialog } from "./CreateViewDialog";
import { useTableOperations } from "@/hooks/useTableOperations";
import { databaseService } from "@/services/tauri";
import type {
  CollectionInfo,
  FunctionInfo,
  TableInfo,
} from "@/services/tauri/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  isMaterializedViewObject,
  isReadOnlyRelationObject,
  isViewObject,
  pluralizeNamespaceLabel,
  relationObjectLabel,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import {
  collectionDeleteQueryTemplateForCapabilities,
  databaseObjectPreviewProvider,
  collectionPreviewQueryTemplateForCapabilities,
  collectionPreviewTabTitleForCapabilities,
} from "@/lib/databaseObjectPreview";
import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

function routineMatchesFilter(routine: FunctionInfo, filter: string) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;

  return [
    routine.name,
    routine.routine_type,
    routine.return_type,
    routine.description,
    ...(routine.parameters || []).flatMap((parameter) => [
      parameter.name,
      parameter.data_type,
    ]),
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalizedFilter));
}

export function SchemaSidebar() {
  const { activeConnectionId, connections } = useConnectionStore();
  const {
    isLoading,
    schemas,
    currentSchema,
    loadSchemas,
    loadTables,
    loadCollections,
    loadFunctions,
    tables,
    collections,
    functions,
    pinnedTables,
    togglePinTable,
    setCurrentSchema,
    selectTable,
    selectedTable,
    bumpMetadataVersion,
    isCollectionsLoading,
    isFunctionsLoading,
  } = useSchemaStore();

  const [filterText, setFilterText] = useState("");
  const [databaseFilter, setDatabaseFilter] = useState("");
  const [isSelectOpen, setIsSelectOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [isCreateDbDialogOpen, setIsCreateDbDialogOpen] = useState(false);
  const [isCreateViewDialogOpen, setIsCreateViewDialogOpen] = useState(false);
  const [viewDialogMode, setViewDialogMode] = useState<"create" | "edit">(
    "create"
  );
  const [viewDialogKind, setViewDialogKind] = useState<
    "view" | "materializedView"
  >("view");
  const [viewDialogInitialName, setViewDialogInitialName] = useState("");
  const [viewDialogInitialSql, setViewDialogInitialSql] = useState("");
  const [isTablesHovered, setIsTablesHovered] = useState(false);

  // Context Menu State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [ddlViewerOpen, setDdlViewerOpen] = useState(false);
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [activeTable, setActiveTable] = useState("");
  const [activeTableType, setActiveTableType] = useState<string | null>(null);
  const [ddlContent, setDdlContent] = useState("");
  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState(() =>
    defaultDatabaseCapabilities(DEFAULT_DATABASE_DRIVER)
  );

  const {
    truncateTable,
    dropTable,
    renameTable,
    exportTableData,
    getTableDdl,
    getViewDefinition,
    refreshMaterializedView,
  } = useTableOperations();

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const activeDriver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const activeCapabilities =
    capabilities.driver === activeDriver
      ? capabilities
      : defaultDatabaseCapabilities(activeDriver);
  const canBrowseTables = supportsTableWorkspace(activeCapabilities);
  const canBrowseCollections =
    activeCapabilities.supportsCollectionBrowsing ||
    activeCapabilities.supportsKeyValueBrowsing;
  const collectionPreviewProvider =
    databaseObjectPreviewProvider(activeCapabilities);
  const collectionLabel = collectionPreviewProvider.objectLabel;
  const collectionLabelPlural =
    collectionPreviewProvider.objectPluralLabel ||
    `${collectionPreviewProvider.objectLabel}s`;
  const objectSectionLabel = canBrowseTables
    ? "Tables"
    : canBrowseCollections
      ? collectionLabelPlural
      : "Objects";
  const namespaceLabel = activeCapabilities.namespaceLabel || "database";
  const namespaceLabelPlural = pluralizeNamespaceLabel(namespaceLabel);
  const canMutateNamespaces = activeCapabilities.supportsCreateDatabase;

  const handleRenameClick = (table: TableInfo) => {
    setActiveTable(table.name);
    setActiveTableType(table.type || null);
    setRenameDialogOpen(true);
  };

  const handleDdlClick = async (table: TableInfo) => {
    setActiveTable(table.name);
    setActiveTableType(table.type || null);
    const ddl = await getTableDdl(table.name, table.type);
    setDdlContent(ddl);
    setDdlViewerOpen(true);
  };

  const handleEditColumnsClick = (table: TableInfo) => {
    setActiveTable(table.name);
    setActiveTableType(table.type || null);
    setColumnsDialogOpen(true);
  };

  const handleEditViewClick = async (table: TableInfo) => {
    if (!isViewObject(table.type) || isMaterializedViewObject(table.type)) return;
    setActiveTable(table.name);
    setActiveTableType(table.type || null);

    try {
      const definition = await getViewDefinition(table.name, table.type);
      setViewDialogMode("edit");
      setViewDialogKind("view");
      setViewDialogInitialName(table.name);
      setViewDialogInitialSql(definition);
      setIsCreateViewDialogOpen(true);
    } catch (e: any) {
      window.alert(`Failed to load view definition: ${e}`);
    }
  };

  const handleTruncateClick = async (table: TableInfo) => {
    if (isReadOnlyRelationObject(table.type)) return;
    const confirmed = window.confirm(
      `Empty all rows from "${table.name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    await truncateTable(table.name);
  };

  const handleDropClick = async (table: TableInfo) => {
    const label = relationObjectLabel(table.type).toLowerCase();
    const confirmed = window.confirm(
      `Drop ${label} "${table.name}"? This will remove the ${label}.`
    );
    if (!confirmed) return;
    await dropTable(table.name, table.type);
  };

  const handleRefreshMaterializedViewClick = async (table: TableInfo) => {
    if (!isMaterializedViewObject(table.type)) return;
    try {
      await refreshMaterializedView(table.name, table.type);
    } catch (e: any) {
      window.alert(`Failed to refresh materialized view: ${e}`);
    }
  };

  useEffect(() => {
    if (activeConnectionId) {
      loadSchemas(activeConnectionId);
    }
  }, [activeConnectionId, loadSchemas]);

  useEffect(() => {
    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(activeDriver);
    setCapabilities(fallback);

    databaseService
      .getDatabaseCapabilities(activeDriver)
      .then((nextCapabilities) => {
        if (!cancelled) setCapabilities(nextCapabilities);
      })
      .catch((error) => {
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) setCapabilities(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [activeDriver]);

  useEffect(() => {
    if (activeConnectionId && currentSchema && canBrowseTables) {
      loadTables(activeConnectionId, currentSchema);
    }
  }, [activeConnectionId, canBrowseTables, currentSchema, loadTables]);

  useEffect(() => {
    if (activeConnectionId && currentSchema && canBrowseCollections) {
      loadCollections(activeConnectionId, currentSchema);
    }
  }, [
    activeConnectionId,
    canBrowseCollections,
    currentSchema,
    loadCollections,
  ]);

  useEffect(() => {
    if (
      activeConnectionId &&
      currentSchema &&
      canBrowseTables &&
      activeCapabilities.supportsFunctions
    ) {
      loadFunctions(activeConnectionId, currentSchema);
    }
  }, [
    activeConnectionId,
    canBrowseTables,
    currentSchema,
    activeCapabilities.supportsFunctions,
    loadFunctions,
  ]);

  // Clear database filter when select closes
  useEffect(() => {
    if (!isSelectOpen) {
      setDatabaseFilter("");
      setFocusedIndex(0);
    }
  }, [isSelectOpen]);

  // Reset focus when filter changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [databaseFilter]);

  // Sort tables: pinned first, then alphabetical
  const sortedTables = (canBrowseTables ? [...tables] : []).sort((a, b) => {
    const aPinned = pinnedTables.includes(a.name);
    const bPinned = pinnedTables.includes(b.name);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return a.name.localeCompare(b.name);
  });

  // Filter tables based on search text
  const filteredTables = sortedTables.filter((table) =>
    table.name.toLowerCase().includes(filterText.toLowerCase())
  );
  const filteredCollections = (canBrowseCollections ? [...collections] : [])
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((collection) =>
      collection.name.toLowerCase().includes(filterText.toLowerCase())
    );
  const filteredFunctions = functions.filter((routine) =>
    routineMatchesFilter(routine, filterText)
  );

  // Filter namespaces based on search text
  const filteredSchemas = schemas.filter((schema) =>
    schema.toLowerCase().includes(databaseFilter.toLowerCase())
  );

  // Handle keyboard input when select is open
  useEffect(() => {
    if (!isSelectOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle typing (alphanumeric and some special chars)
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setDatabaseFilter((prev) => prev + e.key);
      }
      // Handle backspace
      else if (e.key === "Backspace") {
        e.preventDefault();
        setDatabaseFilter((prev) => prev.slice(0, -1));
      }
      // Handle Escape to clear filter or close
      else if (e.key === "Escape") {
        e.preventDefault();
        if (databaseFilter) {
          setDatabaseFilter("");
        } else {
          setIsSelectOpen(false);
        }
      }
      // Arrow key navigation
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) =>
          Math.min(prev + 1, filteredSchemas.length - 1)
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      }
      // Enter to select focused item
      else if (e.key === "Enter" && filteredSchemas.length > 0) {
        e.preventDefault();
        const selectedSchema = filteredSchemas[focusedIndex];
        if (selectedSchema) {
          setCurrentSchema(selectedSchema);
          setFilterText("");
          setIsSelectOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isSelectOpen,
    databaseFilter,
    focusedIndex,
    filteredSchemas,
    setCurrentSchema,
    setFilterText,
  ]);

  const {
    findOrCreateTableTab,
    findOrCreateObjectQueryTab,
    loadTablePage,
    createTableTab,
    createTab,
    runTabQuery,
  } = useTabStore();

  const handleTableSelect = (tableName: string) => {
    selectTable(tableName);
  };

  const handleTableDoubleClick = (table: TableInfo) => {
    if (!currentSchema || !activeConnectionId) return;

    // Use findOrCreateTableTab to reuse existing tabs
    const tabId = findOrCreateTableTab(
      activeConnectionId,
      currentSchema,
      table.name,
      table.type
    );

    void loadTablePage(tabId, 0);
  };

  const handleCollectionSelect = (collectionName: string) => {
    selectTable(collectionName);
  };

  const collectionPreviewSql = (collection: CollectionInfo) =>
    collectionPreviewQueryTemplateForCapabilities(
      activeCapabilities,
      currentSchema,
      collection
    );

  const collectionDeleteSql = (collection: CollectionInfo) =>
    collectionDeleteQueryTemplateForCapabilities(
      activeCapabilities,
      currentSchema,
      collection
    );

  const handleCollectionDoubleClick = (collection: CollectionInfo) => {
    if (!activeConnectionId) return;

    const sql = collectionPreviewSql(collection);
    const tabId = findOrCreateObjectQueryTab(
      activeConnectionId,
      currentSchema,
      collection.name,
      collection.type,
      sql,
      collectionPreviewTabTitleForCapabilities(
        activeCapabilities,
        collection,
        currentSchema
      )
    );
    void runTabQuery(tabId, activeConnectionId, sql);
  };

  const handleCopyCollectionPreview = async (collection: CollectionInfo) => {
    try {
      await navigator.clipboard.writeText(collectionPreviewSql(collection));
    } catch (err: any) {
      window.alert(`Failed to copy preview request: ${err?.message || err}`);
    }
  };

  const handleDeleteCollectionClick = (collection: CollectionInfo) => {
    if (!activeConnectionId) return;

    const sql = collectionDeleteSql(collection);
    if (!sql) {
      window.alert(
        `${activeCapabilities.displayName} ${collectionLabel.toLowerCase()} deletion is not supported.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete ${collectionLabel.toLowerCase()} "${collection.name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    const tabId = createTab("query", `Delete ${collection.name}`, sql, {
      connectionId: activeConnectionId,
      schemaName: currentSchema || undefined,
      tableName: collection.name,
      objectType: collection.type || null,
    });
    void runTabQuery(tabId, activeConnectionId, sql);
  };

  // Highlight matching text
  const highlightMatch = (text: string, filter: string) => {
    if (!filter) return <span>{text}</span>;

    const index = text.toLowerCase().indexOf(filter.toLowerCase());
    if (index === -1) return <span>{text}</span>;

    const before = text.slice(0, index);
    const match = text.slice(index, index + filter.length);
    const after = text.slice(index + filter.length);

    return (
      <span>
        {before}
        <span className="bg-primary text-primary-foreground font-bold">
          {match}
        </span>
        {after}
      </span>
    );
  };

  const routineSignature = (routine: FunctionInfo) => {
    const parameters = (routine.parameters || [])
      .map((parameter) =>
        [parameter.name, parameter.data_type].filter(Boolean).join(" ")
      )
      .join(", ");
    return `${routine.name}(${parameters})`;
  };

  const routineKindLabel = (routine: FunctionInfo) =>
    routine.routine_type?.toLowerCase() === "procedure" ? "proc" : "fn";

  const handleCreateTable = () => {
    if (activeConnectionId && currentSchema && canBrowseTables) {
      createTableTab(activeConnectionId, currentSchema);
    }
  };

  const handleCreateView = () => {
    if (activeConnectionId && currentSchema && activeCapabilities.supportsViews) {
      setViewDialogMode("create");
      setViewDialogKind("view");
      setViewDialogInitialName("");
      setViewDialogInitialSql("");
      setIsCreateViewDialogOpen(true);
    }
  };

  const handleCreateMaterializedView = () => {
    if (
      activeConnectionId &&
      currentSchema &&
      canBrowseTables &&
      activeCapabilities.supportsMaterializedViews
    ) {
      setViewDialogMode("create");
      setViewDialogKind("materializedView");
      setViewDialogInitialName("");
      setViewDialogInitialSql("");
      setIsCreateViewDialogOpen(true);
    }
  };

  const handleCreateDatabase = () => {
    if (!activeCapabilities.supportsCreateDatabase) {
      setNamespaceError(
        `${activeCapabilities.displayName} ${namespaceLabel} creation is not supported.`
      );
      return;
    }
    setIsCreateDbDialogOpen(true);
  };

  const handleRenameDatabase = async () => {
    if (!activeConnectionId || !currentSchema) return;
    if (!activeCapabilities.supportsRenameDatabase) {
      setNamespaceError(
        `${activeCapabilities.displayName} ${namespaceLabel} rename is not supported safely.`
      );
      return;
    }

    const nextName = window.prompt(`Rename ${namespaceLabel} to:`, currentSchema);
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === currentSchema) return;

    setNamespaceError(null);
    try {
      await databaseService.renameDatabase(
        activeConnectionId,
        activeDriver,
        currentSchema,
        trimmedName
      );
      await loadSchemas(activeConnectionId, true);
      await setCurrentSchema(trimmedName);
      bumpMetadataVersion();
    } catch (err: any) {
      setNamespaceError(err?.message || String(err));
    }
  };

  const handleDropDatabase = async () => {
    if (!activeConnectionId || !currentSchema) return;
    if (!canMutateNamespaces) {
      setNamespaceError(
        `${activeCapabilities.displayName} ${namespaceLabel} deletion is not supported.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Drop ${namespaceLabel} "${currentSchema}" and all contained objects? This cannot be undone.`
    );
    if (!confirmed) return;

    setNamespaceError(null);
    try {
      await databaseService.dropDatabase(
        activeConnectionId,
        activeDriver,
        currentSchema,
        true
      );
      await loadSchemas(activeConnectionId, true);
      bumpMetadataVersion();
    } catch (err: any) {
      setNamespaceError(err?.message || String(err));
    }
  };

  const handleRefresh = async () => {
    if (activeConnectionId) {
      // Force refresh schemas
      await loadSchemas(activeConnectionId, true);
      // If currentSchema is selected, force refresh tables too
      if (currentSchema && canBrowseTables) {
        await loadTables(activeConnectionId, currentSchema, true);
        if (activeCapabilities.supportsFunctions) {
          await loadFunctions(activeConnectionId, currentSchema, true);
        }
      }
      if (currentSchema && canBrowseCollections) {
        await loadCollections(activeConnectionId, currentSchema, true);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-tertiary">
      {/* Top: Database Selector Group */}
      <div className="p-2 border-b border-border bg-background-secondary/50 shrink-0">
        <div className="flex items-center gap-2">
          <Select
            value={currentSchema || ""}
            onValueChange={(value: string) => {
              setCurrentSchema(value);
              setFilterText(""); // Clear table filter when switching database
              setIsSelectOpen(false);
            }}
            open={isSelectOpen}
            onOpenChange={setIsSelectOpen}
          >
            <SelectTrigger className="w-full h-7 text-[11px] bg-background-tertiary border-border focus:border-primary text-foreground flex-1">
              <SelectValue placeholder={`Select ${namespaceLabel}...`} />
            </SelectTrigger>
            <SelectContent className="bg-background-elevated border-border text-foreground">
              {/* Filter indicator at top-right (no input box) */}
              {databaseFilter && (
                <div className="sticky top-0 z-10 bg-background-elevated px-2 py-1.5 border-b border-border flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground italic">
                    Type to filter...
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded bg-background-tertiary text-primary font-mono border border-border">
                      {databaseFilter}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                      {filteredSchemas.length}/{schemas.length}
                    </span>
                  </div>
                </div>
              )}

              {/* Namespace list */}
              <div className="max-h-[300px] overflow-auto">
                {isLoading && schemas.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-gray-500 italic">
                    Loading...
                  </div>
                ) : filteredSchemas.length === 0 ? (
                  <div className="px-2 py-1.5 text-[11px] text-gray-500 italic">
                    {databaseFilter ? (
                      <>
                        No match for{" "}
                        <span className="text-primary font-mono">
                          "{databaseFilter}"
                        </span>
                        <div className="text-[9px] mt-1 opacity-60">
                          Press Esc to clear
                        </div>
                      </>
                    ) : (
                      `No ${namespaceLabelPlural} found`
                    )}
                  </div>
                ) : (
                  filteredSchemas.map((schema, index) => (
                    <SelectItem
                      key={schema}
                      value={schema}
                      className={cn(
                        "text-[11px] focus:bg-background-tertiary focus:text-foreground",
                        index === focusedIndex &&
                          "bg-background-tertiary text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Database size={12} className="text-gray-500" />
                        {highlightMatch(schema, databaseFilter)}
                      </div>
                    </SelectItem>
                  ))
                )}
              </div>
            </SelectContent>
          </Select>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-background-tertiary rounded-sm"
            onClick={handleRefresh}
            title={`Refresh ${namespaceLabelPlural}`}
            disabled={isLoading}
          >
            <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-background-tertiary rounded-sm"
            onClick={handleCreateDatabase}
            title={
              activeCapabilities.supportsCreateDatabase
                ? `Create new ${namespaceLabel}`
                : `${activeCapabilities.displayName} ${namespaceLabel} creation is not supported`
            }
            disabled={!activeCapabilities.supportsCreateDatabase}
          >
            <Plus size={12} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground hover:bg-background-tertiary rounded-sm"
            onClick={handleRenameDatabase}
            title={
              !activeCapabilities.supportsRenameDatabase
                ? `${activeCapabilities.displayName} ${namespaceLabel} rename is not supported`
                : `Rename ${namespaceLabel}`
            }
            disabled={!currentSchema || !activeCapabilities.supportsRenameDatabase}
          >
            <Pencil size={12} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:bg-background-tertiary rounded-sm"
            onClick={handleDropDatabase}
            title={
              canMutateNamespaces
                ? `Drop ${namespaceLabel}`
                : `${activeCapabilities.displayName} ${namespaceLabel} deletion is not supported`
            }
            disabled={!currentSchema || !canMutateNamespaces}
          >
            <Trash2 size={12} />
          </Button>
        </div>
        {namespaceError && (
          <div className="mt-1 text-[10px] text-destructive truncate">
            {namespaceError}
          </div>
        )}
      </div>

      {/* Middle: Filter Input for Tables */}
      <div className="p-2 border-b border-border bg-background-secondary/30 shrink-0">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Filter objects..."
            className="w-full bg-background-tertiary text-foreground text-[11px] h-7 pl-7 pr-2 rounded-sm border border-border focus:border-primary focus:outline-none transition-colors placeholder:text-muted-foreground/50"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            disabled={!currentSchema}
          />
        </div>
      </div>

      {/* Tables Section Header - Contextual */}
      <div
        className="flex items-center justify-between px-2 py-1.5 bg-background-tertiary shrink-0"
        onMouseEnter={() => setIsTablesHovered(true)}
        onMouseLeave={() => setIsTablesHovered(false)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
            {objectSectionLabel}
          </span>
          {currentSchema && (
            <span className="text-[9px] bg-background-secondary px-1.5 py-0.5 rounded text-muted-foreground border border-border">
              {canBrowseTables
                ? filteredTables.length
                : canBrowseCollections
                  ? filteredCollections.length
                  : 0}
            </span>
          )}
        </div>

        {/* Action buttons - only show on hover of tables area */}
        {isTablesHovered && currentSchema && canBrowseTables && (
          <div
            className={cn(
              "flex items-center gap-1 transition-opacity duration-200",
              isTablesHovered ? "opacity-100" : "opacity-0"
            )}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
              onClick={handleRefresh}
              title="Refresh Tables"
              disabled={isLoading}
            >
              <RefreshCw
                size={10}
                className={cn(isLoading && "animate-spin")}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
              onClick={handleCreateTable}
              title="Create New Table"
              disabled={!currentSchema || !canBrowseTables}
            >
              <Plus size={10} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
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
                className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
                onClick={handleCreateMaterializedView}
                title="Create New Materialized View"
                disabled={!currentSchema}
              >
                <TableProperties size={10} />
              </Button>
            )}
          </div>
        )}
        {isTablesHovered &&
          currentSchema &&
          !canBrowseTables &&
          canBrowseCollections && (
            <div
              className={cn(
                "flex items-center gap-1 transition-opacity duration-200",
                isTablesHovered ? "opacity-100" : "opacity-0"
              )}
            >
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-primary rounded-sm"
                onClick={handleRefresh}
                title={`Refresh ${collectionLabelPlural}`}
                disabled={isCollectionsLoading}
              >
                <RefreshCw
                  size={10}
                  className={cn(isCollectionsLoading && "animate-spin")}
                />
              </Button>
            </div>
          )}
      </div>

      {/* Bottom: Tables List */}
      <div
        className="flex-1 overflow-auto bg-background-tertiary py-0 custom-scrollbar"
        onMouseEnter={() => setIsTablesHovered(true)}
        onMouseLeave={() => setIsTablesHovered(false)}
      >
       {!currentSchema ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            Select a {namespaceLabel} to view objects
          </div>
        ) : canBrowseCollections ? (
          isCollectionsLoading && collections.length === 0 ? (
            <div className="p-4 text-xs text-center text-gray-500 italic">
              Loading {collectionLabelPlural.toLowerCase()}...
            </div>
          ) : filteredCollections.length === 0 ? (
            <div className="p-4 text-xs text-center text-gray-500 italic">
              {filterText
                ? `No ${collectionLabelPlural.toLowerCase()} match "${filterText}"`
                : `No ${collectionLabelPlural.toLowerCase()} found`}
            </div>
          ) : (
            <div className="px-1">
              {filteredCollections.map((collection) => {
                const canDeleteCollection = Boolean(collectionDeleteSql(collection));
                return (
                  <ContextMenu
                    key={`${collection.namespace || currentSchema}:${collection.name}`}
                    onOpenChange={(open) => {
                      if (open) handleCollectionSelect(collection.name);
                    }}
                  >
                    <ContextMenuTrigger>
                      <div
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 cursor-pointer text-[11px] group transition-all select-none rounded-sm relative",
                          selectedTable === collection.name
                            ? "bg-background-secondary text-primary"
                            : "text-muted-foreground hover:text-foreground hover:bg-background-secondary/50"
                        )}
                        onClick={() => handleCollectionSelect(collection.name)}
                        onDoubleClick={() => handleCollectionDoubleClick(collection)}
                        title={collection.name}
                      >
                        <Braces
                          size={12}
                          className={cn(
                            "shrink-0 opacity-70",
                            selectedTable === collection.name && "opacity-100"
                          )}
                        />
                        <span className="truncate flex-1">
                          {highlightMatch(collection.name, filterText)}
                        </span>
                        {collection.type && (
                          <span className="text-[9px] uppercase opacity-50 shrink-0">
                            {collection.type}
                          </span>
                        )}
                        {collection.documentCount !== null &&
                          collection.documentCount !== undefined && (
                            <span className="text-[9px] opacity-50 shrink-0 tabular-nums">
                              {collection.documentCount}
                            </span>
                          )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48">
                      <ContextMenuItem
                        onClick={() => handleCollectionDoubleClick(collection)}
                      >
                        <Code2 className="mr-2 h-3.5 w-3.5" />
                        Open Preview
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => void handleCopyCollectionPreview(collection)}
                      >
                        <Clipboard className="mr-2 h-3.5 w-3.5" />
                        Copy Preview Query
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        onClick={() => handleDeleteCollectionClick(collection)}
                        disabled={!canDeleteCollection}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete {collectionLabel}
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )
        ) : !canBrowseTables ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            Object browsing is not supported by this driver
          </div>
        ) : isLoading && tables.length === 0 ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            Loading tables...
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="p-4 text-xs text-center text-gray-500 italic">
            {filterText ? `No tables match "${filterText}"` : "No tables found"}
          </div>
        ) : (
          <div className="px-1">
            {filteredTables.map((table) => {
              const isPinned = pinnedTables.includes(table.name);
              const isView = isViewObject(table.type);
              const isMaterializedView = isMaterializedViewObject(table.type);
              const isReadOnlyRelation = isReadOnlyRelationObject(table.type);
              return (
                <ContextMenu
                  key={table.name}
                  onOpenChange={(open) => {
                    if (open) handleTableSelect(table.name);
                  }}
                >
                  <ContextMenuTrigger>
                    <div
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 cursor-pointer text-[11px] group transition-all select-none rounded-sm relative",
                        selectedTable === table.name
                          ? "bg-background-secondary text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-background-secondary/50"
                      )}
                      onClick={() => handleTableSelect(table.name)}
                      onDoubleClick={() => handleTableDoubleClick(table)}
                      title={table.name}
                    >
                      <Table
                        size={12}
                        className={cn(
                          "shrink-0 opacity-70",
                          selectedTable === table.name && "opacity-100",
                          isPinned && "text-primary opacity-100"
                        )}
                      />
                      <span
                        className={cn(
                          "truncate flex-1",
                          isPinned && "font-bold text-foreground"
                        )}
                      >
                        {table.name}
                      </span>

                      {/* Pin/Unpin Button - Visible on Hover */}
                      <div className="flex items-center gap-1">
                        {table.type && !isPinned && (
                          <span className="text-[9px] uppercase opacity-50 shrink-0 group-hover:hidden">
                            {isView ? "view" : table.type}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-4 w-4 shrink-0 transition-all duration-200",
                            isPinned
                              ? "text-primary opacity-100"
                              : "text-muted-foreground opacity-0 group-hover:opacity-60 hover:opacity-100"
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinTable(table.name);
                          }}
                          title={isPinned ? "Unpin Table" : "Pin Table"}
                        >
                          {isPinned ? <PinOff size={10} /> : <Pin size={10} />}
                        </Button>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-48">
                    <ContextMenuItem
                      onClick={() => handleTruncateClick(table)}
                      disabled={isReadOnlyRelation}
                    >
                      <Eraser className="mr-2 h-3.5 w-3.5" />
                      Empty Table
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => handleRenameClick(table)}
                    >
                      <Pencil className="mr-2 h-3.5 w-3.5" />
                      Rename {relationObjectLabel(table.type)}
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => exportTableData(table.name, "csv")}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Export CSV
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => exportTableData(table.name, "json")}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Export JSON
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => handleEditColumnsClick(table)}
                      disabled={isReadOnlyRelation}
                    >
                      <TableProperties className="mr-2 h-3.5 w-3.5" />
                      Edit Columns
                    </ContextMenuItem>
                    {isView && !isMaterializedView && (
                      <ContextMenuItem onClick={() => handleEditViewClick(table)}>
                        <Code2 className="mr-2 h-3.5 w-3.5" />
                        Edit View
                      </ContextMenuItem>
                    )}
                    {isMaterializedView && (
                      <ContextMenuItem
                        onClick={() => handleRefreshMaterializedViewClick(table)}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        Refresh Materialized View
                      </ContextMenuItem>
                    )}
                    <ContextMenuItem onClick={() => handleDdlClick(table)}>
                      <Code2 className="mr-2 h-3.5 w-3.5" />
                      View DDL
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => handleDropClick(table)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Drop {relationObjectLabel(table.type)}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
        {currentSchema && activeCapabilities.supportsFunctions && (
          <div className="mt-2 border-t border-border/60 px-1 pt-1 pb-2">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
                Routines
              </span>
              <span className="text-[9px] bg-background-secondary px-1.5 py-0.5 rounded text-muted-foreground border border-border">
                {filteredFunctions.length}
              </span>
            </div>
            {isFunctionsLoading && functions.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-gray-500 italic">
                Loading routines...
              </div>
            ) : filteredFunctions.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] text-gray-500 italic">
                {filterText
                  ? `No routines match "${filterText}"`
                  : "No routines found"}
              </div>
            ) : (
              filteredFunctions.map((routine, index) => {
                const signature = routineSignature(routine);
                const returnType = routine.return_type || "unknown";
                return (
                  <div
                    key={`${routine.name}:${signature}:${index}`}
                    className="group px-2 py-1.5 rounded-sm text-[11px] text-muted-foreground hover:text-foreground hover:bg-background-secondary/50"
                    title={`${signature} -> ${returnType}`}
                  >
                    <div className="flex items-center gap-2">
                      <Code2 size={12} className="shrink-0 opacity-70" />
                      <span className="truncate flex-1">
                        {highlightMatch(routine.name, filterText)}
                      </span>
                      <span className="text-[9px] uppercase opacity-50 shrink-0">
                        {routineKindLabel(routine)}
                      </span>
                    </div>
                    <div className="ml-5 mt-0.5 truncate text-[10px] text-muted-foreground/70 font-mono">
                      {signature}
                      {returnType && ` -> ${returnType}`}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <CreateDatabaseDialog
        isOpen={isCreateDbDialogOpen}
        onClose={() => setIsCreateDbDialogOpen(false)}
        activeConnectionId={activeConnectionId || ""}
      />
      <RenameTableDialog
        isOpen={renameDialogOpen}
        onClose={() => setRenameDialogOpen(false)}
        tableName={activeTable}
        objectLabel={relationObjectLabel(activeTableType)}
        onRename={(oldName, newName) =>
          renameTable(oldName, newName, activeTableType)
        }
      />
      <DdlViewerDialog
        isOpen={ddlViewerOpen}
        onClose={() => setDdlViewerOpen(false)}
        tableName={activeTable}
        ddl={ddlContent}
      />
      <EditColumnsDialog
        isOpen={columnsDialogOpen}
        onClose={() => setColumnsDialogOpen(false)}
        connectionId={activeConnectionId || ""}
        driver={activeDriver}
        schema={currentSchema || ""}
        tableName={activeTable}
      />
      <CreateViewDialog
        isOpen={isCreateViewDialogOpen}
        onClose={() => setIsCreateViewDialogOpen(false)}
        connectionId={activeConnectionId || ""}
        driver={activeDriver}
        schema={currentSchema || ""}
        mode={viewDialogMode}
        viewKind={viewDialogKind}
        initialViewName={viewDialogInitialName}
        initialSelectSql={viewDialogInitialSql}
      />
    </div>
  );
}
