import { cn } from "@/lib/utils";
import {
  Database,
  Table,
  Braces,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  Pin,
  PinOff,
  Pencil,
  Download,
  TableProperties,
  Code2,
  Trash2,
  Clipboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getConnectionMetadataNodeKey,
  getConnectionMetadataSnapshotKey,
  getSchemaMetadataNodeKey,
  getSchemaObjectMetadataSnapshotKey,
  useSchemaStore,
  type MetadataNodeState,
} from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
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
  collectionCreateQueryTemplateForCapabilities,
  collectionDeleteQueryTemplateForCapabilities,
  databaseObjectPreviewProvider,
  collectionPreviewQueryTemplateForCapabilities,
  collectionPreviewTabTitleForCapabilities,
} from "@/lib/databaseObjectPreview";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

const DRIVER_TREE_COLORS: Record<string, string> = {
  postgres: "#5b8dd6",
  mysql: "#d9904f",
  redis: "#d95b5b",
  elasticsearch: "#d6ad5b",
  mongodb: "#5fb878",
};

function connectionTreeColor(driver: string | null | undefined, color?: string) {
  return color || DRIVER_TREE_COLORS[driver || ""] || "#75a7ff";
}

function connectionRegionStyle(color: string, _active: boolean): CSSProperties {
  return {
    "--connection-color": color,
    backgroundColor: "transparent",
    borderColor: "transparent",
  } as CSSProperties;
}

function MetadataNodeBadge({ state }: { state?: MetadataNodeState }) {
  if (!state || state.status === "idle") return null;

  if (state.status === "loading") {
    return (
      <RefreshCw
        size={10}
        className="shrink-0 animate-spin text-[hsl(var(--wb-text-muted))]"
        aria-label="Loading metadata"
      />
    );
  }

  if (state.status === "error") {
    return (
      <span
        className="shrink-0 rounded-[3px] border border-red-500/35 px-1 text-[9px] leading-4 text-red-300"
        title={state.message || "Metadata refresh failed"}
      >
        error
      </span>
    );
  }

  if (state.status === "stale") {
    return (
      <span
        className="shrink-0 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] px-1 text-[9px] leading-4 wb-muted"
        title={state.message || "Metadata may be stale"}
      >
        stale
      </span>
    );
  }

  if (state.source === "cache") {
    return (
      <span
        className="shrink-0 rounded-[3px] px-1 text-[9px] leading-4 wb-muted"
        title={state.message || "Loaded from local metadata cache"}
      >
        cache
      </span>
    );
  }

  return null;
}

export function SchemaSidebar() {
  const { activeConnectionId, connections, setActiveConnection } =
    useConnectionStore();
  const { activeProjectId } = useProjectStore();
  const {
    isLoading,
    schemas,
    currentSchema,
    defaultSchema,
    loadSchemas,
    loadTables,
    loadCollections,
    loadFunctions,
    tables,
    collections,
    functions,
    pinnedTables,
    connectionSnapshots,
    objectSnapshots,
    hydrateConnectionMetadataFromCache,
    forgetConnectionMetadata,
    forgetSchemaMetadata,
    togglePinTable,
    setCurrentSchema,
    selectTable,
    selectedTable,
    bumpMetadataVersion,
    isCollectionsLoading,
    isFunctionsLoading,
    metadataNodeStates,
  } = useSchemaStore();

  const [filterText, setFilterText] = useState("");
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
  const [schemaPickerOpen, setSchemaPickerOpen] = useState(false);
  const [schemaVisibilityKey, setSchemaVisibilityKey] = useState<string | null>(
    null
  );
  const [showAllSchemas, setShowAllSchemas] = useState(false);
  const [visibleSchemaNames, setVisibleSchemaNames] = useState<string[]>([]);
  const [expandedConnectionIds, setExpandedConnectionIds] = useState<string[]>(
    []
  );
  const [expandedSchemaKeys, setExpandedSchemaKeys] = useState<string[]>([]);
  const [expandedObjectGroupKeys, setExpandedObjectGroupKeys] = useState<
    string[]
  >([]);

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
  const collectionNamespace = currentSchema || "";
  const collectionNamespaceForTemplate = collectionNamespace || null;
  const collectionPreviewProvider =
    databaseObjectPreviewProvider(activeCapabilities);
  const collectionLabel = collectionPreviewProvider.objectLabel;
  const collectionLabelPlural =
    collectionPreviewProvider.objectPluralLabel ||
    `${collectionPreviewProvider.objectLabel}s`;
  const objectSectionLabel = canBrowseTables
    ? "tables"
    : canBrowseCollections
      ? collectionLabelPlural
      : "Objects";
  const namespaceLabel = activeCapabilities.namespaceLabel || "database";
  const namespaceLabelPlural = pluralizeNamespaceLabel(namespaceLabel);
  const canMutateNamespaces = activeCapabilities.supportsCreateDatabase;
  const schemaVisibilityStorageKey = activeConnectionId
    ? `oxide-studio-visible-schemas:${activeProjectId}:${activeConnectionId}:${activeDriver}`
    : null;
  const preferredVisibleSchema =
    [currentSchema, defaultSchema, activeConnection?.database, schemas[0]].find(
      (schema): schema is string =>
        Boolean(schema && (schemas.length === 0 || schemas.includes(schema)))
    ) || null;
  const visibleSchemaSet = useMemo(
    () => new Set(visibleSchemaNames),
    [visibleSchemaNames]
  );
  const schemaRows = useMemo(() => {
    if (schemas.length === 0) {
      return currentSchema ? [currentSchema] : [];
    }

    if (showAllSchemas) return schemas;

    const rows = schemas.filter((schema) => visibleSchemaSet.has(schema));
    if (
      currentSchema &&
      schemas.includes(currentSchema) &&
      !rows.includes(currentSchema)
    ) {
      rows.unshift(currentSchema);
    }

    if (rows.length === 0 && preferredVisibleSchema) {
      return [preferredVisibleSchema];
    }

    return rows;
  }, [
    currentSchema,
    preferredVisibleSchema,
    schemas,
    showAllSchemas,
    visibleSchemaSet,
  ]);
  const schemaCountLabel = showAllSchemas
    ? String(schemas.length)
    : `${schemaRows.length} of ${schemas.length}`;
  const metadataForConnection = (connectionId: string, driver?: string | null) => {
    const isActiveConnection = connectionId === activeConnectionId;
    const snapshot =
      connectionSnapshots[getConnectionMetadataSnapshotKey(connectionId, driver)];

    return {
      isActiveConnection,
      schemas: isActiveConnection ? schemas : snapshot?.schemas ?? [],
      currentSchema: isActiveConnection
        ? currentSchema
        : snapshot?.currentSchema ?? null,
      defaultSchema: isActiveConnection
        ? defaultSchema
        : snapshot?.defaultSchema ?? null,
      selectedTable: isActiveConnection
        ? selectedTable
        : snapshot?.selectedTable ?? null,
      isLoading: isActiveConnection ? isLoading : false,
      nodeState:
        metadataNodeStates[getConnectionMetadataNodeKey(connectionId, driver)],
    };
  };
  const menuContentClass =
    "w-72 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_14px_32px_rgba(0,0,0,0.35)]";
  const menuItemClass =
    "h-7 rounded-[3px] px-2 text-[12px] text-[hsl(var(--wb-text))] focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]";
  const menuSubClass =
    "h-7 rounded-[3px] px-2 text-[12px] text-[hsl(var(--wb-text))] focus:bg-[hsl(var(--wb-hover))] data-[state=open]:bg-[hsl(var(--wb-hover))]";
  const menuSeparatorClass = "bg-[hsl(var(--wb-border-subtle))]";
  const checkboxClass =
    "h-3.5 w-3.5 rounded-[3px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] data-[state=checked]:border-[hsl(var(--wb-accent))] data-[state=checked]:bg-[hsl(var(--wb-accent))] data-[state=checked]:text-[hsl(var(--wb-accent-foreground))]";
  const schemaTreeKey = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string
  ) => `${connectionId}:${driver || "unknown"}:${schema}`;
  const objectGroupKey = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    group: string
  ) => `${connectionId}:${driver || "unknown"}:${schema}:${group}`;

  const updateVisibleSchemas = (showAll: boolean, names: string[]) => {
    const normalizedNames = Array.from(new Set(names)).filter(
      (schema) => schemas.length === 0 || schemas.includes(schema)
    );
    setShowAllSchemas(showAll);
    setVisibleSchemaNames(normalizedNames);

    if (!schemaVisibilityStorageKey) return;

    try {
      localStorage.setItem(
        schemaVisibilityStorageKey,
        JSON.stringify({ all: showAll, schemas: normalizedNames })
      );
    } catch (error) {
      console.warn("Failed to persist visible schemas", error);
    }
  };

  const handleToggleAllSchemas = (checked: boolean | "indeterminate") => {
    const nextChecked = checked === true;
    updateVisibleSchemas(
      nextChecked,
      nextChecked ? schemas : preferredVisibleSchema ? [preferredVisibleSchema] : []
    );
  };

  const handleToggleSchemaVisibility = (
    schema: string,
    checked: boolean | "indeterminate"
  ) => {
    const nextChecked = checked === true;

    if (showAllSchemas && !nextChecked) {
      updateVisibleSchemas(
        false,
        schemas.filter((item) => item !== schema)
      );
      return;
    }

    const nextNames = nextChecked
      ? [...visibleSchemaNames, schema]
      : visibleSchemaNames.filter((item) => item !== schema);
    updateVisibleSchemas(false, nextNames);
  };

  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error: any) {
      window.alert(`Failed to copy: ${error?.message || error}`);
    }
  };

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

  const handleCopyTableDdl = async (table: TableInfo) => {
    const ddl = await getTableDdl(table.name, table.type);
    await copyText(ddl);
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
    if (!activeConnectionId) return;

    setExpandedConnectionIds((current) =>
      current.includes(activeConnectionId)
        ? current
        : [...current, activeConnectionId]
    );
  }, [activeConnectionId]);

  useEffect(() => {
    if (!activeConnectionId || !currentSchema) return;

    const key = schemaTreeKey(activeConnectionId, activeDriver, currentSchema);
    const tablesKey = objectGroupKey(
      activeConnectionId,
      activeDriver,
      currentSchema,
      "objects"
    );
    setExpandedSchemaKeys((current) =>
      current.includes(key) ? current : [...current, key]
    );
    setExpandedObjectGroupKeys((current) =>
      current.includes(tablesKey) ? current : [...current, tablesKey]
    );
  }, [activeConnectionId, currentSchema]);

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
    if (!schemaVisibilityStorageKey) {
      setSchemaVisibilityKey(null);
      setShowAllSchemas(false);
      setVisibleSchemaNames([]);
      return;
    }

    if (schemaVisibilityKey !== schemaVisibilityStorageKey) {
      let loaded = false;

      try {
        const saved = localStorage.getItem(schemaVisibilityStorageKey);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            all?: unknown;
            schemas?: unknown;
          };
          setShowAllSchemas(parsed.all === true);
          setVisibleSchemaNames(
            Array.isArray(parsed.schemas)
              ? parsed.schemas.filter(
                  (schema): schema is string => typeof schema === "string"
                )
              : []
          );
          loaded = true;
        }
      } catch (error) {
        console.warn("Failed to restore visible schemas", error);
      }

      if (!loaded) {
        const initialSchemas = preferredVisibleSchema
          ? [preferredVisibleSchema]
          : [];
        setShowAllSchemas(false);
        setVisibleSchemaNames(initialSchemas);
        try {
          localStorage.setItem(
            schemaVisibilityStorageKey,
            JSON.stringify({ all: false, schemas: initialSchemas })
          );
        } catch (error) {
          console.warn("Failed to persist initial visible schemas", error);
        }
      }

      setSchemaVisibilityKey(schemaVisibilityStorageKey);
      return;
    }

    if (
      !showAllSchemas &&
      visibleSchemaNames.length === 0 &&
      preferredVisibleSchema
    ) {
      updateVisibleSchemas(false, [preferredVisibleSchema]);
    }
  }, [
    preferredVisibleSchema,
    schemaVisibilityKey,
    schemaVisibilityStorageKey,
    showAllSchemas,
    visibleSchemaNames.length,
  ]);

  useEffect(() => {
    if (activeConnectionId && currentSchema && canBrowseTables) {
      loadTables(activeConnectionId, currentSchema);
    }
  }, [activeConnectionId, canBrowseTables, currentSchema, loadTables]);

  useEffect(() => {
    if (activeConnectionId && canBrowseCollections) {
      loadCollections(activeConnectionId, collectionNamespace);
    }
  }, [
    activeConnectionId,
    canBrowseCollections,
    collectionNamespace,
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

  const schemaObjectsFor = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string
  ) => {
    const isActiveSchema =
      connectionId === activeConnectionId && schema === currentSchema;
    const snapshot =
      isActiveSchema
        ? null
        : objectSnapshots[
            getSchemaObjectMetadataSnapshotKey(connectionId, driver, schema)
          ];
    const schemaTables = canBrowseTables
      ? snapshot?.tables ?? (isActiveSchema ? tables : [])
      : [];
    const schemaCollections = canBrowseCollections
      ? snapshot?.collections ?? (isActiveSchema ? collections : [])
      : [];
    const schemaFunctions =
      snapshot?.functions ?? (isActiveSchema ? functions : []);
    const schemaPinnedTables =
      snapshot?.pinnedTables ?? (isActiveSchema ? pinnedTables : []);

    const sortedTables = [...schemaTables].sort((a, b) => {
      const aPinned = schemaPinnedTables.includes(a.name);
      const bPinned = schemaPinnedTables.includes(b.name);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return a.name.localeCompare(b.name);
    });

    return {
      tables: sortedTables.filter((table) =>
        table.name.toLowerCase().includes(filterText.toLowerCase())
      ),
      collections: [...schemaCollections]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((collection) =>
          collection.name.toLowerCase().includes(filterText.toLowerCase())
        ),
      functions: schemaFunctions.filter((routine) =>
        routineMatchesFilter(routine, filterText)
      ),
      pinnedTables: schemaPinnedTables,
      hasSnapshot: Boolean(snapshot),
    };
  };

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

  const handleTableDoubleClick = async (
    table: TableInfo,
    schemaName = currentSchema || ""
  ) => {
    if (!schemaName || !activeConnectionId) return;

    if (schemaName !== currentSchema) {
      await handleSchemaSelect(schemaName);
    }

    // Use findOrCreateTableTab to reuse existing tabs
    const tabId = findOrCreateTableTab(
      activeConnectionId,
      schemaName,
      table.name,
      table.type
    );

    await loadTablePage(tabId, 0);
  };

  const handleCollectionSelect = (collectionName: string) => {
    selectTable(collectionName);
  };

  const collectionPreviewSql = (collection: CollectionInfo) =>
    collectionPreviewQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      collection
    );

  const collectionDeleteSql = (collection: CollectionInfo) =>
    collectionDeleteQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      collection
    );

  const collectionCreateSql = (name: string) =>
    collectionCreateQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      name
    );

  const refreshCollectionObjects = async () => {
    if (!activeConnectionId || !canBrowseCollections) return;
    await loadCollections(activeConnectionId, collectionNamespace, true);
    bumpMetadataVersion();
  };

  const runCollectionMutation = async (tabId: string, sql: string) => {
    if (!activeConnectionId) return;

    await runTabQuery(tabId, activeConnectionId, sql);
    const tab = useTabStore.getState().tabs.find((item) => item.id === tabId);
    if (!tab?.error) {
      await refreshCollectionObjects();
    }
  };

  const handleCollectionDoubleClick = (collection: CollectionInfo) => {
    if (!activeConnectionId) return;

    const sql = collectionPreviewSql(collection);
    const tabId = findOrCreateObjectQueryTab(
      activeConnectionId,
      collectionNamespace,
      collection.name,
      collection.type,
      sql,
      collectionPreviewTabTitleForCapabilities(
        activeCapabilities,
        collection,
        collectionNamespaceForTemplate
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
      schemaName: collectionNamespace || undefined,
      tableName: collection.name,
      objectType: collection.type || null,
    });
    void runCollectionMutation(tabId, sql);
  };

  const handleCreateCollectionClick = () => {
    if (!activeConnectionId) return;

    const rawName = window.prompt(`New ${collectionLabel.toLowerCase()} name:`);
    if (rawName === null) return;

    const name = rawName.trim();
    if (!name) return;

    const sql = collectionCreateSql(name);
    if (!sql) {
      window.alert(
        `${activeCapabilities.displayName} ${collectionLabel.toLowerCase()} creation is not supported.`
      );
      return;
    }

    const tabId = createTab("query", `Create ${collectionLabel}: ${name}`, sql, {
      connectionId: activeConnectionId,
      schemaName: collectionNamespace || undefined,
      tableName: name,
      objectType: collectionLabel.toLowerCase(),
    });
    void runCollectionMutation(tabId, sql);
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

  const handleRenameDatabase = async (schemaOverride?: string) => {
    const targetSchema = schemaOverride || currentSchema;
    if (!activeConnectionId || !targetSchema) return;
    if (!activeCapabilities.supportsRenameDatabase) {
      setNamespaceError(
        `${activeCapabilities.displayName} ${namespaceLabel} rename is not supported safely.`
      );
      return;
    }

    const nextName = window.prompt(`Rename ${namespaceLabel} to:`, targetSchema);
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === targetSchema) return;

    setNamespaceError(null);
    try {
      await databaseService.renameDatabase(
        activeConnectionId,
        activeDriver,
        targetSchema,
        trimmedName
      );
      await loadSchemas(activeConnectionId, true);
      await setCurrentSchema(trimmedName);
      bumpMetadataVersion();
    } catch (err: any) {
      setNamespaceError(err?.message || String(err));
    }
  };

  const handleDropDatabase = async (schemaOverride?: string) => {
    const targetSchema = schemaOverride || currentSchema;
    if (!activeConnectionId || !targetSchema) return;
    if (!canMutateNamespaces) {
      setNamespaceError(
        `${activeCapabilities.displayName} ${namespaceLabel} deletion is not supported.`
      );
      return;
    }

    const confirmed = window.confirm(
      `Drop ${namespaceLabel} "${targetSchema}" and all contained objects? This cannot be undone.`
    );
    if (!confirmed) return;

    setNamespaceError(null);
    try {
      await databaseService.dropDatabase(
        activeConnectionId,
        activeDriver,
        targetSchema,
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
      if (canBrowseCollections) {
        await loadCollections(activeConnectionId, collectionNamespace, true);
      }
    }
  };

  const handleRefreshConnection = async (connectionId: string) => {
    if (connectionId !== activeConnectionId) {
      await setActiveConnection(connectionId);
    }
    await loadSchemas(connectionId, true);
  };

  const handleRefreshSchema = async (connectionId: string, schema: string) => {
    if (connectionId !== activeConnectionId) {
      await setActiveConnection(connectionId);
    }
    await handleSchemaSelect(schema);
    if (canBrowseTables) {
      await loadTables(connectionId, schema, true);
      if (activeCapabilities.supportsFunctions) {
        await loadFunctions(connectionId, schema, true);
      }
    }
    if (canBrowseCollections) {
      await loadCollections(connectionId, schema, true);
    }
  };

  const handleForgetConnectionMetadata = async (
    connectionId: string,
    connectionName: string
  ) => {
    const confirmed = window.confirm(
      `Forget cached metadata for "${connectionName}"? The next refresh will introspect the data source again.`
    );
    if (!confirmed) return;

    await forgetConnectionMetadata(connectionId);
    setExpandedSchemaKeys((current) =>
      current.filter((key) => !key.startsWith(`${connectionId}:`))
    );
    setExpandedObjectGroupKeys((current) =>
      current.filter((key) => !key.startsWith(`${connectionId}:`))
    );
  };

  const handleForgetSchemaMetadata = async (
    connectionId: string,
    driver: string | null | undefined,
    schema: string
  ) => {
    const confirmed = window.confirm(
      `Forget cached object metadata for "${schema}"? The schema will stay listed, but tables and routines will be loaded again on refresh.`
    );
    if (!confirmed) return;

    await forgetSchemaMetadata(connectionId, schema);
    const groupPrefix = objectGroupKey(connectionId, driver, schema, "");
    setExpandedObjectGroupKeys((current) =>
      current.filter((key) => !key.startsWith(groupPrefix))
    );
  };

  const handleSchemaSelect = async (schema: string) => {
    await setCurrentSchema(schema);
    setFilterText("");
  };

  const runForSchema = async (
    schema: string,
    action: () => void | Promise<void>
  ) => {
    if (schema !== currentSchema) {
      await handleSchemaSelect(schema);
    }
    await action();
  };

  const handleConnectionRowClick = async (connectionId: string) => {
    const isExpanded = expandedConnectionIds.includes(connectionId);

    if (isExpanded) {
      setExpandedConnectionIds((current) =>
        current.filter((id) => id !== connectionId)
      );
      return;
    }

    await hydrateConnectionMetadataFromCache(connectionId);
    await setActiveConnection(connectionId);
    setExpandedConnectionIds((current) =>
      current.includes(connectionId) ? current : [...current, connectionId]
    );
  };

  const handleSchemaRowClick = async (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean
  ) => {
    const connection = connections.find((item) => item.id === connectionId);
    const driver = connection?.driver || activeDriver;
    const key = schemaTreeKey(connectionId, driver, schema);
    const isExpanded = expandedSchemaKeys.includes(key);

    if (isExpanded) {
      setExpandedSchemaKeys((current) =>
        current.filter((item) => item !== key)
      );
      return;
    }

    if (connectionId !== activeConnectionId) {
      await setActiveConnection(connectionId);
    }

    if (connectionId !== activeConnectionId || !isCurrentSchema) {
      await handleSchemaSelect(schema);
    }
    setExpandedSchemaKeys((current) =>
      current.includes(key) ? current : [...current, key]
    );
  };

  const renderSchemaVisibilityPicker = () => {
    if (!activeConnectionId || schemas.length === 0) return null;

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
            title={`Select visible ${namespaceLabelPlural}`}
            onClick={(event) => event.stopPropagation()}
          >
            {schemaCountLabel}
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
              Select {namespaceLabelPlural}
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
            <label className="flex h-6 cursor-default select-none items-center gap-2 px-2 text-[11px] hover:bg-[hsl(var(--wb-hover))]">
              <Checkbox
                className={checkboxClass}
                checked={showAllSchemas}
                onCheckedChange={handleToggleAllSchemas}
              />
              <span className="font-medium">All schemas</span>
              <span className="ml-auto text-[10px] wb-muted">add pattern</span>
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
                  Default schema{" "}
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

  const renderSchemaObjects = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    _connectionColor: string
  ) => {
    const isCurrentSchema =
      connectionId === activeConnectionId && schema === currentSchema;
    const schemaObjects = schemaObjectsFor(connectionId, driver, schema);
    const schemaObjectCount = canBrowseTables
      ? schemaObjects.tables.length
      : canBrowseCollections
        ? schemaObjects.collections.length
        : 0;
    const hasSchemaObjectContext = canBrowseTables
      ? Boolean(schema)
      : canBrowseCollections;
    const groupKey = objectGroupKey(connectionId, driver, schema, "objects");
    const isObjectGroupExpanded = expandedObjectGroupKeys.includes(groupKey);
    const schemaNodeState =
      metadataNodeStates[getSchemaMetadataNodeKey(connectionId, driver, schema)];
    const isSchemaObjectsLoading =
      schemaNodeState?.status === "loading" ||
      (isCurrentSchema && isLoading && schemaObjects.tables.length === 0);

    const renderRoutines = () => {
      if (!activeCapabilities.supportsFunctions) return null;

      return (
        <div className="mt-1 border-t border-[hsl(var(--wb-border-subtle))] pt-1">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="text-[10px] font-semibold uppercase wb-muted">
              Routines
            </span>
            <span className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1 text-[9px] wb-muted">
              {schemaObjects.functions.length}
            </span>
          </div>
          {isCurrentSchema &&
          isFunctionsLoading &&
          schemaObjects.functions.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] italic wb-muted">
              Loading routines...
            </div>
          ) : schemaObjects.functions.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] italic wb-muted">
              {filterText
                ? `No routines match "${filterText}"`
                : "No routines found"}
            </div>
          ) : (
            schemaObjects.functions.map((routine, index) => {
              const signature = routineSignature(routine);
              const returnType = routine.return_type || "unknown";

              return (
                <div
                  key={`${routine.name}:${signature}:${index}`}
                  className="group rounded-[3px] px-2 py-1.5 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                  title={`${signature} -> ${returnType}`}
                >
                  <div className="flex items-center gap-2">
                    <Code2 size={12} className="shrink-0 opacity-70" />
                    <span className="min-w-0 flex-1 truncate">
                      {highlightMatch(routine.name, filterText)}
                    </span>
                    <span className="shrink-0 text-[9px] uppercase opacity-50">
                      {routineKindLabel(routine)}
                    </span>
                  </div>
                  <div className="ml-5 mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
                    {signature}
                    {returnType && ` -> ${returnType}`}
                  </div>
                </div>
              );
            })
          )}
        </div>
      );
    };

    return (
      <div
        className="ml-4 mt-0.5 border-l border-[hsl(var(--wb-border-subtle))] pb-1 pl-2"
        onMouseEnter={() => setIsTablesHovered(true)}
        onMouseLeave={() => setIsTablesHovered(false)}
      >
        <button
          type="button"
          className="flex h-6 w-full items-center justify-between rounded-[3px] pr-1 text-left hover:bg-[hsl(var(--wb-hover))]"
          onClick={() => {
            setExpandedObjectGroupKeys((current) =>
              current.includes(groupKey)
                ? current.filter((item) => item !== groupKey)
                : [...current, groupKey]
            );
          }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {isObjectGroupExpanded ? (
              <ChevronDown size={12} className="shrink-0 wb-muted" />
            ) : (
              <ChevronRight size={12} className="shrink-0 wb-muted" />
            )}
            <Table size={12} className="shrink-0 wb-muted" />
            <span className="truncate text-[11px] font-medium text-[hsl(var(--wb-text))]">
              {objectSectionLabel}
            </span>
            {hasSchemaObjectContext && (
              <span className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-1 text-[9px] wb-muted">
                {schemaObjectCount}
              </span>
            )}
            <MetadataNodeBadge state={schemaNodeState} />
          </div>
          {isCurrentSchema && isTablesHovered && renderObjectActions()}
        </button>

        {isObjectGroupExpanded && (
          <>
            {!hasSchemaObjectContext ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                Select a {namespaceLabel} to view objects
              </div>
            ) : canBrowseCollections ? (
              isCurrentSchema &&
              isCollectionsLoading &&
              schemaObjects.collections.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                  Loading {collectionLabelPlural.toLowerCase()}...
                </div>
              ) : schemaObjects.collections.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                  {filterText
                    ? `No ${collectionLabelPlural.toLowerCase()} match "${filterText}"`
                    : `No ${collectionLabelPlural.toLowerCase()} found`}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {schemaObjects.collections.map((collection) => {
                    const canDeleteCollection = Boolean(
                      collectionDeleteSql(collection)
                    );
                    const isSelectedCollection =
                      isCurrentSchema && selectedTable === collection.name;

                    return (
                      <ContextMenu
                        key={`${schema}:${collection.name}`}
                        onOpenChange={(open) => {
                          if (open) {
                            void runForSchema(schema, () =>
                              handleCollectionSelect(collection.name)
                            );
                          }
                        }}
                      >
                        <ContextMenuTrigger>
                          <div
                            className={cn(
                              "group flex cursor-pointer select-none items-center gap-2 rounded-[3px] px-2 py-1 text-[11px] transition-colors",
                              isSelectedCollection
                                ? "wb-tree-row-selected"
                                : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]"
                            )}
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleCollectionSelect(collection.name)
                              )
                            }
                            onDoubleClick={() =>
                              void runForSchema(schema, () =>
                                handleCollectionDoubleClick(collection)
                              )
                            }
                            title={collection.name}
                          >
                            <Braces
                              size={12}
                              className={cn(
                                "shrink-0 opacity-70",
                                isSelectedCollection && "opacity-100"
                              )}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {highlightMatch(collection.name, filterText)}
                            </span>
                            {collection.type && (
                              <span className="shrink-0 text-[9px] uppercase opacity-50">
                                {collection.type}
                              </span>
                            )}
                            {collection.documentCount !== null &&
                              collection.documentCount !== undefined && (
                                <span className="shrink-0 text-[9px] tabular-nums opacity-50">
                                  {collection.documentCount}
                                </span>
                              )}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-48">
                          <ContextMenuItem
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleCollectionDoubleClick(collection)
                              )
                            }
                          >
                            <Code2 className="mr-2 h-3.5 w-3.5" />
                            Open Preview
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleCopyCollectionPreview(collection)
                              )
                            }
                          >
                            <Clipboard className="mr-2 h-3.5 w-3.5" />
                            Copy Preview Query
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleDeleteCollectionClick(collection)
                              )
                            }
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
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                Object browsing is not supported by this driver
              </div>
            ) : isSchemaObjectsLoading && schemaObjects.tables.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                Loading tables...
              </div>
            ) : schemaObjects.tables.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                {filterText
                  ? `No tables match "${filterText}"`
                  : "No tables found"}
              </div>
            ) : (
              <div className="space-y-0.5">
                {schemaObjects.tables.map((table) => {
                  const isPinned = schemaObjects.pinnedTables.includes(
                    table.name
                  );
                  const isView = isViewObject(table.type);
                  const isMaterializedView = isMaterializedViewObject(
                    table.type
                  );
                  const isReadOnlyRelation = isReadOnlyRelationObject(
                    table.type
                  );
                  const isSelectedTable =
                    isCurrentSchema && selectedTable === table.name;

                  return (
                    <ContextMenu
                      key={`${schema}:${table.name}`}
                      onOpenChange={(open) => {
                        if (open) {
                          void runForSchema(schema, () =>
                            handleTableSelect(table.name)
                          );
                        }
                      }}
                    >
                      <ContextMenuTrigger asChild>
                        <div
                          className={cn(
                            "group flex cursor-pointer select-none items-center gap-2 rounded-[3px] px-2 py-1 text-[11px] transition-colors",
                            isSelectedTable
                              ? "wb-tree-row-selected"
                              : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]"
                          )}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleTableSelect(table.name)
                            )
                          }
                          onDoubleClick={() =>
                            void handleTableDoubleClick(table, schema)
                          }
                          title={table.name}
                        >
                          <Table
                            size={12}
                            className={cn(
                              "shrink-0 opacity-70",
                              isSelectedTable && "opacity-100",
                              isPinned && "text-primary opacity-100"
                            )}
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              isPinned && "font-bold text-foreground"
                            )}
                          >
                            {table.name}
                          </span>
                          <div className="flex items-center gap-1">
                            {table.type && !isPinned && (
                              <span className="shrink-0 text-[9px] uppercase opacity-50 group-hover:hidden">
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
                              onClick={(event) => {
                                event.stopPropagation();
                                void runForSchema(schema, () =>
                                  togglePinTable(table.name)
                                );
                              }}
                              title={isPinned ? "Unpin Table" : "Pin Table"}
                            >
                              {isPinned ? (
                                <PinOff size={10} />
                              ) : (
                                <Pin size={10} />
                              )}
                            </Button>
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className={menuContentClass}>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      <Plus className="mr-2 h-3.5 w-3.5" />
                      New
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () => {
                              if (activeConnectionId) {
                                createTableTab(activeConnectionId, schema);
                              }
                            })
                          }
                          disabled={!activeConnectionId || !canBrowseTables}
                        >
                          Table
                        </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, handleCreateView)
                          }
                          disabled={!activeCapabilities.supportsViews}
                        >
                          View
                        </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(
                              schema,
                              handleCreateMaterializedView
                            )
                          }
                          disabled={
                            !activeCapabilities.supportsMaterializedViews
                          }
                        >
                        Materialized View
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>

                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      Copy/Paste
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() => void copyText(table.name)}
                      >
                        Copy Name
                      </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleCopyTableDdl(table)
                            )
                          }
                        >
                          Copy DDL
                        </ContextMenuItem>
                      <ContextMenuItem className={menuItemClass} disabled>
                        Paste
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>

                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() =>
                        void runForSchema(schema, async () => {
                          if (!activeConnectionId) return;
                          if (canBrowseTables) {
                            await loadTables(activeConnectionId, schema, true);
                            if (activeCapabilities.supportsFunctions) {
                              await loadFunctions(
                                activeConnectionId,
                                schema,
                                true
                              );
                            }
                          }
                          if (canBrowseCollections) {
                            await loadCollections(activeConnectionId, schema, true);
                          }
                        })
                      }
                      disabled={isLoading}
                    >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    Refresh
                    <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                  </ContextMenuItem>
                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() =>
                        void runForSchema(schema, () => handleRenameClick(table))
                      }
                    >
                    Rename...
                    <ContextMenuShortcut>⇧F6</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator className={menuSeparatorClass} />

                    <ContextMenuItem
                      className={menuItemClass}
                      onClick={() =>
                        void runForSchema(schema, () => handleDdlClick(table))
                      }
                    >
                    Quick Documentation
                    <ContextMenuShortcut>F1</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuItem className={menuItemClass} disabled>
                    Compare Schema Structure With...
                    <ContextMenuShortcut>⌘D</ContextMenuShortcut>
                  </ContextMenuItem>

                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      Navigation
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void handleTableDoubleClick(table, schema)
                          }
                        >
                        Open Data
                      </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleDdlClick(table)
                            )
                          }
                        >
                        Go to DDL
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem className={menuItemClass} disabled>
                    Find Usages
                    <ContextMenuShortcut>⌥F7</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator className={menuSeparatorClass} />

                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      Introspection Level
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                      <ContextMenuItem className={menuItemClass}>
                        Standard
                      </ContextMenuItem>
                      <ContextMenuItem className={menuItemClass} disabled>
                        Full
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>

                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      SQL Scripts
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleDdlClick(table)
                            )
                          }
                        >
                        Show DDL
                      </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleCopyTableDdl(table)
                            )
                          }
                        >
                        Copy DDL
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>

                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      Tools
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              togglePinTable(table.name)
                            )
                          }
                        >
                        {isPinned ? "Unpin" : "Pin"}
                      </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleEditColumnsClick(table)
                            )
                          }
                          disabled={isReadOnlyRelation}
                        >
                        Edit Columns
                      </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              handleTruncateClick(table)
                            )
                          }
                          disabled={isReadOnlyRelation}
                        >
                        Empty Table
                      </ContextMenuItem>
                      {isView && !isMaterializedView && (
                        <ContextMenuItem
                            className={menuItemClass}
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleEditViewClick(table)
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
                                handleRefreshMaterializedViewClick(table)
                              )
                            }
                          >
                          Refresh Materialized View
                        </ContextMenuItem>
                      )}
                    </ContextMenuSubContent>
                  </ContextMenuSub>

                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={menuSubClass}>
                      Import/Export
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={menuContentClass}>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              exportTableData(table.name, "csv")
                            )
                          }
                        >
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Export CSV
                      </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            void runForSchema(schema, () =>
                              exportTableData(table.name, "json")
                            )
                          }
                        >
                        <Download className="mr-2 h-3.5 w-3.5" />
                        Export JSON
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem className={menuItemClass} disabled>
                    Diagrams
                  </ContextMenuItem>
                  <ContextMenuSeparator className={menuSeparatorClass} />
                  <ContextMenuItem className={menuItemClass} disabled>
                    Diagnostics
                  </ContextMenuItem>
                  <ContextMenuSeparator className={menuSeparatorClass} />
                    <ContextMenuItem
                      onClick={() =>
                        void runForSchema(schema, () => handleDropClick(table))
                      }
                      className={cn(menuItemClass, "text-destructive")}
                    >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Drop {relationObjectLabel(table.type)}...
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      )}

            {renderRoutines()}
          </>
        )}
      </div>
    );
  };

    return (
    <div className="flex flex-col h-full wb-panel">
      <div className="wb-panel-header h-8 gap-2">
        <span className="truncate text-[12px] font-semibold">
          Database Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="wb-icon-button h-5 w-5"
            onClick={handleRefresh}
            title="Synchronize"
            disabled={isLoading}
          >
            <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-1">
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button"
          onClick={handleCreateDatabase}
          title={
            activeCapabilities.supportsCreateDatabase
              ? `Create new ${namespaceLabel}`
              : `${activeCapabilities.displayName} ${namespaceLabel} creation is not supported`
          }
          disabled={!activeCapabilities.supportsCreateDatabase}
        >
          <Plus size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button"
          onClick={handleRefresh}
          title={`Refresh ${namespaceLabelPlural}`}
          disabled={isLoading}
        >
          <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
        </Button>
        <span className="mx-1 h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button"
          onClick={handleCreateTable}
          title="Create New Table"
          disabled={!currentSchema || !canBrowseTables}
        >
          <Table size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button"
          onClick={handleCreateView}
          title="Create New View"
          disabled={!currentSchema || !activeCapabilities.supportsViews}
        >
          <Code2 size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button"
          onClick={() => void handleRenameDatabase()}
          title={
            !activeCapabilities.supportsRenameDatabase
              ? `${activeCapabilities.displayName} ${namespaceLabel} rename is not supported`
              : `Rename ${namespaceLabel}`
          }
          disabled={!currentSchema || !activeCapabilities.supportsRenameDatabase}
        >
          <Pencil size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="wb-icon-button hover:text-destructive"
          onClick={() => void handleDropDatabase()}
          title={
            canMutateNamespaces
              ? `Drop ${namespaceLabel}`
              : `${activeCapabilities.displayName} ${namespaceLabel} deletion is not supported`
          }
          disabled={!currentSchema || !canMutateNamespaces}
        >
          <Trash2 size={13} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[hsl(var(--wb-panel))] px-1 py-1 custom-scrollbar">
        <div className="space-y-0.5">
          {connections.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] italic wb-muted">
              No data sources configured
            </div>
          ) : (
            connections.map((connection) => {
              const connectionColor = connectionTreeColor(
                connection.driver,
                connection.color
              );
              const isActive = connection.id === activeConnectionId;
              const connectionMetadata = metadataForConnection(
                connection.id,
                connection.driver
              );
              const connectionSchemas = isActive
                ? schemaRows
                : connectionMetadata.schemas;
              const isConnectionExpanded =
                expandedConnectionIds.includes(connection.id);

              return (
                  <div
                    key={connection.id}
                    className="rounded-[3px] border border-transparent transition-colors"
                    style={connectionRegionStyle(connectionColor, isActive)}
                  >
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] transition-colors",
                      isActive
                        ? "text-[hsl(var(--wb-text))]"
                        : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                    )}
                    onClick={() =>
                      void handleConnectionRowClick(connection.id)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void handleConnectionRowClick(connection.id);
                      }
                    }}
                  >
                    {isConnectionExpanded ? (
                      <ChevronDown size={13} className="shrink-0 wb-muted" />
                    ) : (
                      <ChevronRight size={13} className="shrink-0 wb-muted" />
                    )}
                    <Database
                      size={13}
                      className="shrink-0"
                      style={{ color: connectionColor }}
                    />
                    <span className="truncate font-medium">
                      {connection.name}
                    </span>
                    <MetadataNodeBadge state={connectionMetadata.nodeState} />
                    <span className="ml-auto shrink-0 text-[9px] uppercase wb-muted">
                      {connection.driver}
                    </span>
                    {isActive && renderSchemaVisibilityPicker()}
                  </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={menuContentClass}>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger className={menuSubClass}>
                          <Plus className="mr-2 h-3.5 w-3.5" />
                          New
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className={menuContentClass}>
                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={handleCreateDatabase}
                            disabled={!activeCapabilities.supportsCreateDatabase}
                          >
                            {namespaceLabel}
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={handleCreateTable}
                            disabled={!isActive || !currentSchema || !canBrowseTables}
                          >
                            Table
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() => void copyText(connection.name)}
                      >
                        Copy Name
                      </ContextMenuItem>
                      <ContextMenuSeparator className={menuSeparatorClass} />
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          void (async () => {
                            await handleRefreshConnection(connection.id);
                          })()
                        }
                        disabled={isLoading}
                      >
                        <RefreshCw className="mr-2 h-3.5 w-3.5" />
                        Refresh Selected
                        <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          void handleForgetConnectionMetadata(
                            connection.id,
                            connection.name
                          )
                        }
                      >
                        Forget Cached Metadata
                      </ContextMenuItem>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() => void handleRenameDatabase()}
                        disabled={
                          !isActive ||
                          !currentSchema ||
                          !activeCapabilities.supportsRenameDatabase
                        }
                      >
                        Rename...
                        <ContextMenuShortcut>⇧F6</ContextMenuShortcut>
                      </ContextMenuItem>
                      <ContextMenuSeparator className={menuSeparatorClass} />
                      <ContextMenuSub>
                        <ContextMenuSubTrigger className={menuSubClass}>
                          Introspection Level
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className={menuContentClass}>
                          <ContextMenuItem className={menuItemClass}>
                            Standard
                          </ContextMenuItem>
                          <ContextMenuItem className={menuItemClass} disabled>
                            Full
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      <ContextMenuItem className={menuItemClass} disabled>
                        Diagnostics
                      </ContextMenuItem>
                      <ContextMenuSeparator className={menuSeparatorClass} />
                      <ContextMenuItem
                        className={cn(menuItemClass, "text-destructive")}
                        onClick={() => void handleDropDatabase()}
                        disabled={!isActive || !currentSchema || !canMutateNamespaces}
                      >
                        Drop...
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  {isConnectionExpanded && (
                    <div className="pb-1 pl-5 pr-1">
                      {(connectionMetadata.isLoading ||
                        connectionMetadata.nodeState?.status === "loading") &&
                      connectionSchemas.length === 0 ? (
                        <div className="px-1.5 py-1 text-[11px] italic wb-muted">
                          Loading {namespaceLabelPlural}...
                        </div>
                      ) : connectionSchemas.length === 0 ? (
                        <div className="px-1.5 py-1 text-[11px] italic wb-muted">
                          No {namespaceLabelPlural} found
                        </div>
                      ) : (
                        connectionSchemas.map((schema) => {
                          const isCurrentSchema =
                            isActive && schema === currentSchema;
                          const schemaKey = schemaTreeKey(
                            connection.id,
                            connection.driver,
                            schema
                          );
                          const isSchemaExpanded =
                            expandedSchemaKeys.includes(schemaKey);
                          const schemaNodeState =
                            metadataNodeStates[
                              getSchemaMetadataNodeKey(
                                connection.id,
                                connection.driver,
                                schema
                              )
                            ];

                          return (
                            <div key={schema} className="min-w-0">
                              <ContextMenu>
                                <ContextMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className={cn(
                                      "flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] transition-colors",
                                      isCurrentSchema
                                        ? "font-medium text-[hsl(var(--wb-text))]"
                                        : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                                    )}
                                    onClick={() => {
                                      void handleSchemaRowClick(
                                        connection.id,
                                        schema,
                                        isCurrentSchema
                                      ).catch((error) => {
                                        console.warn(
                                          "Failed to toggle schema",
                                          error
                                        );
                                      });
                                    }}
                                  >
                                    {isSchemaExpanded ? (
                                      <ChevronDown
                                        size={12}
                                        className="shrink-0 wb-muted"
                                      />
                                    ) : (
                                      <ChevronRight
                                        size={12}
                                        className="shrink-0 wb-muted"
                                      />
                                    )}
                                    <Database
                                      size={12}
                                      className="shrink-0"
                                      style={{ color: connectionColor }}
                                    />
                                    <span className="truncate">{schema}</span>
                                    <MetadataNodeBadge
                                      state={schemaNodeState}
                                    />
                                  </button>
                                </ContextMenuTrigger>
                                <ContextMenuContent className={menuContentClass}>
                                  <ContextMenuSub>
                                    <ContextMenuSubTrigger
                                      className={menuSubClass}
                                    >
                                      <Plus className="mr-2 h-3.5 w-3.5" />
                                      New
                                    </ContextMenuSubTrigger>
                                    <ContextMenuSubContent
                                      className={menuContentClass}
                                    >
                                      <ContextMenuItem
                                        className={menuItemClass}
                                        onClick={() => {
                                          if (activeConnectionId) {
                                            createTableTab(
                                              activeConnectionId,
                                              schema
                                            );
                                          }
                                        }}
                                        disabled={
                                          !activeConnectionId || !canBrowseTables
                                        }
                                      >
                                        Table
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        className={menuItemClass}
                                        onClick={() =>
                                          void runForSchema(
                                            schema,
                                            handleCreateView
                                          )
                                        }
                                        disabled={
                                          !activeCapabilities.supportsViews
                                        }
                                      >
                                        View
                                      </ContextMenuItem>
                                    </ContextMenuSubContent>
                                  </ContextMenuSub>
                                  <ContextMenuItem
                                    className={menuItemClass}
                                    onClick={() => void copyText(schema)}
                                  >
                                    Copy Name
                                  </ContextMenuItem>
                                  <ContextMenuSeparator
                                    className={menuSeparatorClass}
                                  />
                                  <ContextMenuItem
                                    className={menuItemClass}
                                    onClick={() =>
                                      void handleRefreshSchema(
                                        connection.id,
                                        schema
                                      )
                                    }
                                    disabled={isLoading || isCollectionsLoading}
                                  >
                                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                    Refresh Selected
                                    <ContextMenuShortcut>⌘R</ContextMenuShortcut>
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    className={menuItemClass}
                                    onClick={() =>
                                      void handleForgetSchemaMetadata(
                                        connection.id,
                                        connection.driver,
                                        schema
                                      )
                                    }
                                  >
                                    Forget Cached Metadata
                                  </ContextMenuItem>
                                  <ContextMenuItem
                                    className={menuItemClass}
                                    onClick={() =>
                                      void handleRenameDatabase(schema)
                                    }
                                    disabled={
                                      !activeCapabilities.supportsRenameDatabase
                                    }
                                  >
                                    Rename...
                                    <ContextMenuShortcut>⇧F6</ContextMenuShortcut>
                                  </ContextMenuItem>
                                  <ContextMenuSeparator
                                    className={menuSeparatorClass}
                                  />
                                  <ContextMenuSub>
                                    <ContextMenuSubTrigger
                                      className={menuSubClass}
                                    >
                                      Introspection Level
                                    </ContextMenuSubTrigger>
                                    <ContextMenuSubContent
                                      className={menuContentClass}
                                    >
                                      <ContextMenuItem className={menuItemClass}>
                                        Standard
                                      </ContextMenuItem>
                                      <ContextMenuItem
                                        className={menuItemClass}
                                        disabled
                                      >
                                        Full
                                      </ContextMenuItem>
                                    </ContextMenuSubContent>
                                  </ContextMenuSub>
                                  <ContextMenuItem
                                    className={menuItemClass}
                                    disabled
                                  >
                                    Diagnostics
                                  </ContextMenuItem>
                                  <ContextMenuSeparator
                                    className={menuSeparatorClass}
                                  />
                                  <ContextMenuItem
                                    className={cn(
                                      menuItemClass,
                                      "text-destructive"
                                    )}
                                    onClick={() => void handleDropDatabase(schema)}
                                    disabled={!canMutateNamespaces}
                                  >
                                    Drop...
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                              {isSchemaExpanded &&
                                renderSchemaObjects(
                                  connection.id,
                                  connection.driver,
                                  schema,
                                  connectionColor
                                )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {namespaceError && (
          <div className="mt-1 text-[10px] text-destructive truncate">
            {namespaceError}
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
