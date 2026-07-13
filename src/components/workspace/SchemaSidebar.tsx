import { cn } from "@/lib/utils";
import {
  Database,
  Table,
  KeyRound,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Plus,
  Pin,
  PinOff,
  Download,
  TableProperties,
  Code2,
  Trash2,
  Clipboard,
  Folder,
  FolderCog,
  Network,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getConnectionMetadataNodeKey,
  getConnectionMetadataSnapshotKey,
  getSchemaMetadataNodeKey,
  getSchemaObjectMetadataSnapshotKey,
  MAX_REDIS_KEYS_IN_MEMORY,
  REDIS_KEY_PAGE_SIZE,
  useSchemaStore,
  type MetadataNodeState,
} from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { CreateDatabaseDialog } from "./CreateDatabaseDialog";
import { RenameTableDialog } from "./RenameTableDialog";
import { DdlViewerDialog } from "./DdlViewerDialog";
import { EditColumnsDialog } from "./EditColumnsDialog";
import { CreateViewDialog } from "./CreateViewDialog";
import { useTableOperations } from "@/hooks/useTableOperations";
import { databaseService, queryService, schemaService } from "@/services/tauri";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  CollectionInfo,
  DatabaseDriver,
  FunctionInfo,
  TableInfo,
} from "@/services/tauri/types";
import {
  DEFAULT_DATABASE_DRIVER,
  databaseDriverProfile,
  defaultDatabaseCapabilities,
  defaultDatabaseName,
  defaultDatabasePort,
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
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  DatabaseExplorerHeader,
  DatabaseExplorerToolbar,
} from "./DatabaseExplorerChrome";
import { DataSourceDialog } from "./DataSourceDialog";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import { RedisKeyDialog } from "./RedisKeyDialog";
import {
  PostgresDatabaseTree,
  postgresConnectionDatabaseName,
} from "./PostgresDatabaseTree";
import { PostgresRemoteDatabaseContents } from "./PostgresRemoteDatabaseContents";
import { PostgresDatabaseVisibilitySection } from "./PostgresDatabaseVisibilitySection";
import { usePostgresDatabaseDiscovery } from "@/hooks/usePostgresDatabaseDiscovery";
import {
  buildRedisKeyTree,
  type RedisKeyTreeNode,
} from "@/lib/redisKey";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PostgresRemoteDatabaseState {
  connectionId: string | null;
  schemas: Record<string, string[]>;
  tables: Record<string, Record<string, TableInfo[]>>;
}

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

function connectionRegionStyle(
  color: string | undefined,
  active: boolean
): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--connection-color": color,
    backgroundColor: `${color}${active ? "18" : "0b"}`,
    borderColor: active ? `${color}35` : "transparent",
  } as CSSProperties;
}

function schemaTreeKey(
  connectionId: string,
  driver: string | null | undefined,
  schema: string
) {
  return `${connectionId}:${driver || "unknown"}:${schema}`;
}

function objectGroupKey(
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
  group: string
) {
  return `${connectionId}:${driver || "unknown"}:${schema}:${group}`;
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

  return null;
}

export function SchemaSidebar() {
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId
  );
  const connections = useConnectionStore((state) => state.connections);
  const connectedConnectionIds = useConnectionStore(
    (state) => state.connectedConnectionIds
  );
  const setActiveConnection = useConnectionStore(
    (state) => state.setActiveConnection
  );
  const createNewConnection = useConnectionStore(
    (state) => state.createNewConnection
  );
  const updateConnectionConfig = useConnectionStore(
    (state) => state.updateConnectionConfig
  );
  const selectConnection = useConnectionStore(
    (state) => state.selectConnection
  );
  const removeConnection = useConnectionStore(
    (state) => state.removeConnection
  );
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (store) => store.setToolWindowVisible
  );
  const { activeProjectId } = useProjectStore();
  const {
    isLoading,
    schemas,
    currentSchema,
    defaultSchema,
    loadSchemas,
    loadTables,
    loadCollections,
    loadMoreCollections,
    loadFunctions,
    tables,
    collections,
    functions,
    pinnedTables,
    connectionSnapshots,
    objectSnapshots,
    hydrateConnectionMetadataFromCache,
    hydrateSchemaObjectsFromCache,
    forgetConnectionMetadata,
    forgetSchemaMetadata,
    togglePinTable,
    setCurrentSchema,
    selectTable,
    selectedTable,
    bumpMetadataVersion,
    isCollectionsLoading,
    collectionNextCursor,
    collectionTotal,
    isFunctionsLoading,
    metadataNodeStates,
  } = useSchemaStore();

  const [filterText, setFilterText] = useState("");
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [isDataSourceDialogOpen, setIsDataSourceDialogOpen] = useState(false);
  const [isCreateDbDialogOpen, setIsCreateDbDialogOpen] = useState(false);
  const [isCreateViewDialogOpen, setIsCreateViewDialogOpen] = useState(false);
  const [isCreateRedisKeyOpen, setIsCreateRedisKeyOpen] = useState(false);
  const [connectingConnectionIds, setConnectingConnectionIds] = useState<
    string[]
  >([]);
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
  const [postgresDatabaseRefreshVersion, setPostgresDatabaseRefreshVersion] =
    useState(0);
  const [postgresVisibilityKey, setPostgresVisibilityKey] = useState<
    string | null
  >(null);
  const [showAllPostgresDatabases, setShowAllPostgresDatabases] =
    useState(true);
  const [visiblePostgresDatabaseNames, setVisiblePostgresDatabaseNames] =
    useState<string[]>([]);
  const [postgresRemoteDatabases, setPostgresRemoteDatabases] =
    useState<PostgresRemoteDatabaseState>({
      connectionId: null,
      schemas: {},
      tables: {},
    });
  const postgresRemoteRequestIds = useRef<Record<string, number>>({});
  const postgresRemoteRequestCounter = useRef(0);
  const postgresRemoteContextVersion = useRef(0);

  // Context Menu State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [ddlViewerOpen, setDdlViewerOpen] = useState(false);
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [activeTable, setActiveTable] = useState("");
  const [activeTableType, setActiveTableType] = useState<string | null>(null);
  const [ddlContent, setDdlContent] = useState("");
  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const [pendingDataSourceRemoval, setPendingDataSourceRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isRemovingDataSource, setIsRemovingDataSource] = useState(false);
  const [dataSourceRemovalError, setDataSourceRemovalError] = useState<
    string | null
  >(null);
  const [capabilities, setCapabilities] = useState(() =>
    defaultDatabaseCapabilities(DEFAULT_DATABASE_DRIVER)
  );
  const databaseExplorerSettings = useSettingsStore(
    (store) => store.settings.databaseExplorer
  );
  const shouldAutoIntrospect =
    databaseExplorerSettings.refreshMode === "cache-first";
  const shouldLimitVisibleSchemas =
    databaseExplorerSettings.showOnlySelectedSchemas;

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
  const isActiveConnectionReady = Boolean(
    activeConnectionId && connectedConnectionIds.includes(activeConnectionId)
  );
  const activeDriver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  const postgresDatabaseDiscovery = usePostgresDatabaseDiscovery({
    projectId: activeProjectId,
    connectionId: activeConnectionId,
    driver: activeConnection?.driver,
    isConnectionReady: isActiveConnectionReady,
    refreshVersion: postgresDatabaseRefreshVersion,
  });
  const activeCapabilities =
    capabilities.driver === activeDriver
      ? capabilities
      : defaultDatabaseCapabilities(activeDriver);
  const canBrowseTables = supportsTableWorkspace(activeCapabilities);
  const canBrowseCollections =
    activeCapabilities.supportsCollectionBrowsing ||
    activeCapabilities.supportsKeyValueBrowsing;
  const isActiveNamespaceExpanded = Boolean(
    activeConnectionId &&
      currentSchema &&
      (activeCapabilities.dataModel === "keyValue"
        ? expandedObjectGroupKeys.includes(
            objectGroupKey(
              activeConnectionId,
              activeDriver,
              currentSchema,
              "objects"
            )
          )
        : expandedSchemaKeys.includes(
            schemaTreeKey(activeConnectionId, activeDriver, currentSchema)
          ))
  );
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
  const activePostgresDatabase =
    activeConnection?.driver === "postgres"
      ? postgresConnectionDatabaseName(activeConnection)
      : null;
  const postgresDatabaseRows = useMemo(() => {
    if (!activePostgresDatabase) return [];
    const discoveredDatabases =
      postgresDatabaseDiscovery.connectionId === activeConnectionId
        ? postgresDatabaseDiscovery.databases
        : [];
    return [
      activePostgresDatabase,
      ...discoveredDatabases.filter(
        (database) => database !== activePostgresDatabase
      ),
    ].filter(
      (database, index, rows) =>
        Boolean(database) && rows.indexOf(database) === index
    );
  }, [
    activeConnectionId,
    activePostgresDatabase,
    postgresDatabaseDiscovery.connectionId,
    postgresDatabaseDiscovery.databases,
  ]);
  const postgresDatabaseVisibilityStorageKey =
    activeConnectionId && activeDriver === "postgres"
      ? `oxide-studio-visible-databases:${activeProjectId}:${activeConnectionId}`
      : null;
  const visiblePostgresDatabaseSet = useMemo(
    () => new Set(visiblePostgresDatabaseNames),
    [visiblePostgresDatabaseNames]
  );
  const visiblePostgresDatabases = useMemo(
    () =>
      showAllPostgresDatabases
        ? postgresDatabaseRows
        : postgresDatabaseRows.filter((database) =>
            visiblePostgresDatabaseSet.has(database)
          ),
    [
      postgresDatabaseRows,
      showAllPostgresDatabases,
      visiblePostgresDatabaseSet,
    ]
  );
  const postgresDatabaseCountLabel = showAllPostgresDatabases
    ? `${postgresDatabaseRows.length} db`
    : `${visiblePostgresDatabases.length} of ${postgresDatabaseRows.length} db`;
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

    // PostgreSQL schema visibility belongs beneath each database node. Do not
    // apply the legacy connection-wide schema picker to the current database.
    if (activeDriver === "postgres") return schemas;

    if (showAllSchemas || !shouldLimitVisibleSchemas) return schemas;

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
    activeDriver,
    currentSchema,
    preferredVisibleSchema,
    schemas,
    shouldLimitVisibleSchemas,
    showAllSchemas,
    visibleSchemaSet,
  ]);
  const schemaCountLabel =
    activeDriver === "postgres" || showAllSchemas || !shouldLimitVisibleSchemas
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

  const updateVisiblePostgresDatabases = (
    showAll: boolean,
    names: string[]
  ) => {
    const normalizedNames = Array.from(new Set(names)).filter(
      (database) =>
        postgresDatabaseRows.length === 0 ||
        postgresDatabaseRows.includes(database)
    );
    setShowAllPostgresDatabases(showAll);
    setVisiblePostgresDatabaseNames(normalizedNames);

    if (!postgresDatabaseVisibilityStorageKey) return;
    try {
      localStorage.setItem(
        postgresDatabaseVisibilityStorageKey,
        JSON.stringify({ all: showAll, databases: normalizedNames })
      );
    } catch (error) {
      console.warn("Failed to persist visible PostgreSQL databases", error);
    }
  };

  const handleToggleAllPostgresDatabases = (
    checked: boolean | "indeterminate"
  ) => {
    const nextChecked = checked === true;
    updateVisiblePostgresDatabases(
      nextChecked,
      nextChecked ? postgresDatabaseRows : []
    );
  };

  const handleTogglePostgresDatabaseVisibility = (
    database: string,
    checked: boolean | "indeterminate"
  ) => {
    const nextChecked = checked === true;
    if (showAllPostgresDatabases && !nextChecked) {
      updateVisiblePostgresDatabases(
        false,
        postgresDatabaseRows.filter((item) => item !== database)
      );
      return;
    }

    const nextNames = nextChecked
      ? [...visiblePostgresDatabaseNames, database]
      : visiblePostgresDatabaseNames.filter((item) => item !== database);
    updateVisiblePostgresDatabases(false, nextNames);
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
      if (
        isActiveConnectionReady &&
        (shouldAutoIntrospect || activeDriver === "redis")
      ) {
        // Show any hydrated metadata immediately, then refresh only the
        // namespace list. Object metadata stays lazy until its node expands.
        loadSchemas(activeConnectionId, true);
      } else {
        void hydrateConnectionMetadataFromCache(activeConnectionId);
      }
    }
  }, [
    activeConnectionId,
    activeDriver,
    hydrateConnectionMetadataFromCache,
    isActiveConnectionReady,
    loadSchemas,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (!postgresDatabaseVisibilityStorageKey) {
      if (postgresVisibilityKey !== null) {
        setPostgresVisibilityKey(null);
        setShowAllPostgresDatabases(true);
        setVisiblePostgresDatabaseNames([]);
      }
      return;
    }
    if (postgresVisibilityKey === postgresDatabaseVisibilityStorageKey) return;

    let showAll = true;
    let databases: string[] = [];
    try {
      const saved = localStorage.getItem(
        postgresDatabaseVisibilityStorageKey
      );
      if (saved) {
        const parsed = JSON.parse(saved) as {
          all?: unknown;
          databases?: unknown;
        };
        showAll = parsed.all !== false;
        databases = Array.isArray(parsed.databases)
          ? parsed.databases.filter(
              (database): database is string => typeof database === "string"
            )
          : [];
      }
    } catch (error) {
      console.warn("Failed to restore visible PostgreSQL databases", error);
    }

    setShowAllPostgresDatabases(showAll);
    setVisiblePostgresDatabaseNames(databases);
    setPostgresVisibilityKey(postgresDatabaseVisibilityStorageKey);
  }, [postgresDatabaseVisibilityStorageKey, postgresVisibilityKey]);

  useEffect(() => {
    postgresRemoteContextVersion.current += 1;
    setPostgresRemoteDatabases({
      connectionId:
        activeDriver === "postgres" ? activeConnectionId : null,
      schemas: {},
      tables: {},
    });
  }, [activeConnectionId, activeDriver, postgresDatabaseRefreshVersion]);

  useEffect(() => {
    // Project switches select and hydrate the first cached data source. Reveal
    // it immediately so users do not need a click before cached metadata is
    // visible. A manual collapse remains respected until the scope changes.
    setExpandedConnectionIds(activeConnectionId ? [activeConnectionId] : []);
    setExpandedSchemaKeys([]);
    setExpandedObjectGroupKeys([]);
  }, [activeConnectionId, activeProjectId]);

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
          setShowAllSchemas(
            shouldLimitVisibleSchemas ? parsed.all === true : true
          );
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
        setShowAllSchemas(!shouldLimitVisibleSchemas);
        setVisibleSchemaNames(initialSchemas);
        try {
          localStorage.setItem(
            schemaVisibilityStorageKey,
            JSON.stringify({
              all: !shouldLimitVisibleSchemas,
              schemas: initialSchemas,
            })
          );
        } catch (error) {
          console.warn("Failed to persist initial visible schemas", error);
        }
      }

      setSchemaVisibilityKey(schemaVisibilityStorageKey);
      return;
    }

    if (
      shouldLimitVisibleSchemas &&
      !showAllSchemas &&
      visibleSchemaNames.length === 0 &&
      preferredVisibleSchema
    ) {
      updateVisibleSchemas(false, [preferredVisibleSchema]);
    }
  }, [
    preferredVisibleSchema,
    shouldLimitVisibleSchemas,
    schemaVisibilityKey,
    schemaVisibilityStorageKey,
    showAllSchemas,
    visibleSchemaNames.length,
  ]);

  useEffect(() => {
    if (
      shouldAutoIntrospect &&
      isActiveConnectionReady &&
      !isLoading &&
      activeConnectionId &&
      currentSchema &&
      isActiveNamespaceExpanded &&
      canBrowseTables
    ) {
      loadTables(activeConnectionId, currentSchema);
    }
  }, [
    activeConnectionId,
    canBrowseTables,
    currentSchema,
    isActiveNamespaceExpanded,
    isActiveConnectionReady,
    isLoading,
    loadTables,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (
      (shouldAutoIntrospect && isActiveConnectionReady) ||
      activeCapabilities.dataModel === "keyValue" ||
      !activeConnectionId ||
      !currentSchema ||
      !isActiveNamespaceExpanded
    )
      return;
    void hydrateSchemaObjectsFromCache(activeConnectionId, currentSchema);
  }, [
    activeConnectionId,
    activeCapabilities.dataModel,
    currentSchema,
    hydrateSchemaObjectsFromCache,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (
      shouldAutoIntrospect &&
      isActiveConnectionReady &&
      !isLoading &&
      activeConnectionId &&
      isActiveNamespaceExpanded &&
      canBrowseCollections &&
      activeCapabilities.dataModel !== "keyValue"
    ) {
      loadCollections(activeConnectionId, collectionNamespace);
    }
  }, [
    activeConnectionId,
    activeCapabilities.dataModel,
    canBrowseCollections,
    collectionNamespace,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    isLoading,
    loadCollections,
    shouldAutoIntrospect,
  ]);

  useEffect(() => {
    if (
      activeCapabilities.dataModel !== "keyValue" ||
      !isActiveConnectionReady ||
      isLoading ||
      !activeConnectionId ||
      !isActiveNamespaceExpanded
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void loadCollections(
        activeConnectionId,
        collectionNamespace,
        true,
        filterText
      );
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [
    activeCapabilities.dataModel,
    activeConnectionId,
    collectionNamespace,
    filterText,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
    isLoading,
    loadCollections,
  ]);

  useEffect(() => {
    if (
      activeConnectionId &&
      isActiveConnectionReady &&
      currentSchema &&
      isActiveNamespaceExpanded &&
      canBrowseTables &&
      activeCapabilities.supportsFunctions
    ) {
      loadFunctions(activeConnectionId, currentSchema);
    }
  }, [
    activeConnectionId,
    canBrowseTables,
    currentSchema,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
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

  const postgresDatabaseMatchesFilter = (
    connectionId: string,
    database: string,
    currentDatabase: string,
    normalizedFilter: string
  ) => {
    if (!normalizedFilter) return true;
    if (database === currentDatabase) {
      return schemas.some((schema) => {
        if (schema.toLocaleLowerCase().includes(normalizedFilter)) return true;
        const isActiveSchema = schema === currentSchema;
        const snapshot = isActiveSchema
          ? null
          : objectSnapshots[
              getSchemaObjectMetadataSnapshotKey(
                connectionId,
                "postgres",
                schema
              )
            ];
        const schemaTables = isActiveSchema ? tables : snapshot?.tables || [];
        const schemaFunctions = isActiveSchema
          ? functions
          : snapshot?.functions || [];
        return (
          schemaTables.some((table) =>
            table.name.toLocaleLowerCase().includes(normalizedFilter)
          ) ||
          schemaFunctions.some((routine) =>
            routineMatchesFilter(routine, normalizedFilter)
          )
        );
      });
    }

    if (postgresRemoteDatabases.connectionId !== connectionId) return false;
    return (
      (postgresRemoteDatabases.schemas[database] || []).some((schema) =>
        schema.toLocaleLowerCase().includes(normalizedFilter)
      ) ||
      Object.values(postgresRemoteDatabases.tables[database] || {}).some(
        (databaseTables) =>
          databaseTables.some((table) =>
            table.name.toLocaleLowerCase().includes(normalizedFilter)
          )
      )
    );
  };

  const findOrCreateTableTab = useTabStore(
    (state) => state.findOrCreateTableTab
  );
  const findOrCreateObjectQueryTab = useTabStore(
    (state) => state.findOrCreateObjectQueryTab
  );
  const loadTablePage = useTabStore((state) => state.loadTablePage);
  const createTableTab = useTabStore((state) => state.createTableTab);
  const createTab = useTabStore((state) => state.createTab);
  const runTabQuery = useTabStore((state) => state.runTabQuery);
  const setTableMetadata = useTabStore((state) => state.setTableMetadata);

  const handleNewQueryConsole = () => {
    const queryNumber = useTabStore
      .getState()
      .tabs.filter((tab) => tab.type === "query").length + 1;
    const connectionName = activeConnection?.name;
    createTab(
      "query",
      connectionName ? `console [${connectionName}]` : `Query #${queryNumber}`,
      "",
      {
        connectionId: activeConnectionId || undefined,
        schemaName: currentSchema || undefined,
      }
    );
  };

  const handleNewDataSource = (driver: DatabaseDriver) => {
    createNewConnection();
    const profile = databaseDriverProfile(driver);
    updateConnectionConfig({
      driver,
      name: `New ${profile.menuLabel} Connection`,
      port: defaultDatabasePort(driver) || undefined,
      database: defaultDatabaseName(driver),
      icon: profile.defaultIcon,
      connectionUrl: "",
    });
    setIsDataSourceDialogOpen(true);
  };

  const handleOpenConnectionProperties = (connectionId: string) => {
    selectConnection(connectionId);
    setIsDataSourceDialogOpen(true);
  };

  const handleRemoveDataSource = async () => {
    if (!pendingDataSourceRemoval || isRemovingDataSource) return;
    const { id: connectionId } = pendingDataSourceRemoval;
    setNamespaceError(null);
    setDataSourceRemovalError(null);
    setIsRemovingDataSource(true);
    try {
      await removeConnection(connectionId);
      try {
        await forgetConnectionMetadata(connectionId);
      } catch (error) {
        console.warn("Failed to clear removed data source metadata:", error);
      }
      setExpandedConnectionIds((ids) =>
        ids.filter((id) => id !== connectionId)
      );
      setExpandedSchemaKeys((keys) =>
        keys.filter((key) => !key.startsWith(`${connectionId}:`))
      );
      setExpandedObjectGroupKeys((keys) =>
        keys.filter((key) => !key.startsWith(`${connectionId}:`))
      );
      setPendingDataSourceRemoval(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNamespaceError(message);
      setDataSourceRemovalError(message);
    } finally {
      setIsRemovingDataSource(false);
    }
  };

  const handleCollapseAll = () => {
    setExpandedConnectionIds([]);
    setExpandedSchemaKeys([]);
    setExpandedObjectGroupKeys([]);
  };

  const handleExpandActiveConnection = () => {
    if (!activeConnectionId) return;
    void hydrateConnectionMetadataFromCache(activeConnectionId);
    setExpandedConnectionIds((current) =>
      current.includes(activeConnectionId)
        ? current
        : [...current, activeConnectionId]
    );
  };

  const handleRevealActiveConnection = () => {
    handleExpandActiveConnection();
    window.requestAnimationFrame(() => {
      document
        .getElementById(`database-connection-${activeConnectionId}`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

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

  const handlePostgresRemoteTableOpen = async (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    table: TableInfo
  ) => {
    if (!connectionId || !databaseName || !schemaName) return;

    // A PostgreSQL database is a separate connection target, not another
    // schema. Keep the active connection/schema untouched and bind the target
    // database to the table tab itself.
    const tabId = findOrCreateTableTab(
      connectionId,
      schemaName,
      table.name,
      table.type,
      databaseName
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

    if (activeCapabilities.dataModel === "keyValue") {
      setIsCreateRedisKeyOpen(true);
      return;
    }

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

  const handleCreateRedisKey = async (name: string, command: string) => {
    if (!activeConnectionId) throw new Error("No active Redis connection.");
    const normalizedName = name.trim();
    const existing = await queryService.executeQuery(
      activeConnectionId,
      `EXISTS ${JSON.stringify(normalizedName)}`,
      collectionNamespace || undefined
    );
    if (Number(existing[0]?.rows?.[0]?.[1] ?? 0) > 0) {
      throw new Error(`Key "${normalizedName}" already exists.`);
    }
    await queryService.executeQuery(
      activeConnectionId,
      command,
      collectionNamespace || undefined
    );
    await refreshCollectionObjects();
    selectTable(normalizedName);
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
      if (activeConnection?.driver === "postgres") {
        setPostgresDatabaseRefreshVersion((version) => version + 1);
      }
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
        await loadCollections(
          activeConnectionId,
          collectionNamespace,
          true,
          activeCapabilities.dataModel === "keyValue" ? filterText : undefined
        );
      }
    }
  };

  const handleRefreshConnection = async (connectionId: string) => {
    const wasActiveConnection = connectionId === activeConnectionId;
    const connection = connections.find((item) => item.id === connectionId);
    if (connectionId !== activeConnectionId) {
      await setActiveConnection(connectionId);
    }
    if (wasActiveConnection && connection?.driver === "postgres") {
      setPostgresDatabaseRefreshVersion((version) => version + 1);
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
      await loadCollections(
        connectionId,
        schema,
        true,
        activeCapabilities.dataModel === "keyValue" ? filterText : undefined
      );
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
    const isConnected = connectedConnectionIds.includes(connectionId);

    if (isExpanded && isConnected) {
      setExpandedConnectionIds((current) =>
        current.filter((id) => id !== connectionId)
      );
      return;
    }

    // Expand immediately so SQLite metadata can paint while the remote
    // connection is still being established. Keep only the selected source
    // expanded because object capabilities are scoped to the active driver.
    setExpandedConnectionIds([connectionId]);
    if (!isConnected) {
      setConnectingConnectionIds((current) =>
        current.includes(connectionId) ? current : [...current, connectionId]
      );
    }
    try {
      await setActiveConnection(connectionId);
    } finally {
      setConnectingConnectionIds((current) =>
        current.filter((id) => id !== connectionId)
      );
    }
  };

  const loadPostgresRemoteDatabase = async (
    connectionId: string,
    database: string
  ) => {
    const requestKey = `${connectionId}:${database}`;
    const requestId = postgresRemoteRequestCounter.current + 1;
    postgresRemoteRequestCounter.current = requestId;
    const contextVersion = postgresRemoteContextVersion.current;
    postgresRemoteRequestIds.current[requestKey] = requestId;
    const databaseSchemas = await schemaService.getDatabaseSchemas(
      connectionId,
      database
    );

    const connectionState = useConnectionStore.getState();
    const connection = connectionState.connections.find(
      (item) => item.id === connectionId
    );
    if (
      postgresRemoteRequestIds.current[requestKey] !== requestId ||
      postgresRemoteContextVersion.current !== contextVersion ||
      connectionState.activeConnectionId !== connectionId ||
      !connectionState.connectedConnectionIds.includes(connectionId) ||
      connection?.driver !== "postgres"
    ) {
      return;
    }

    setPostgresRemoteDatabases((current) => ({
      connectionId,
      schemas: {
        ...(current.connectionId === connectionId ? current.schemas : {}),
        [database]: Array.from(new Set(databaseSchemas)),
      },
      tables:
        current.connectionId === connectionId ? current.tables : {},
    }));
  };

  const handlePostgresRemoteTablesLoaded = (
    connectionId: string,
    database: string,
    schema: string,
    databaseTables: TableInfo[]
  ) => {
    if (useConnectionStore.getState().activeConnectionId !== connectionId) {
      return;
    }
    setPostgresRemoteDatabases((current) => {
      if (current.connectionId !== connectionId) return current;
      return {
        ...current,
        tables: {
          ...current.tables,
          [database]: {
            ...(current.tables[database] || {}),
            [schema]: databaseTables,
          },
        },
      };
    });
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
    if (!shouldAutoIntrospect) {
      await hydrateSchemaObjectsFromCache(connectionId, schema);
    }
    setExpandedSchemaKeys((current) =>
      current.includes(key) ? current : [...current, key]
    );
    const objectsKey = objectGroupKey(connectionId, driver, schema, "objects");
    setExpandedObjectGroupKeys((current) =>
      current.includes(objectsKey) ? current : [...current, objectsKey]
    );
  };

  const renderSchemaVisibilityPicker = () => {
    const isPostgresPicker = activeDriver === "postgres";
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
                onToggleDatabase={
                  handleTogglePostgresDatabaseVisibility
                }
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
                <span className="font-medium">All schemas</span>
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
    const tableRelations = schemaObjects.tables.filter(
      (table) => !isViewObject(table.type)
    );
    const virtualViews = schemaObjects.tables.filter((table) =>
      isViewObject(table.type)
    );
    const schemaObjectCount = canBrowseTables
      ? tableRelations.length
      : canBrowseCollections
        ? schemaObjects.collections.length
        : 0;
    const schemaObjectCountLabel =
      activeCapabilities.dataModel === "keyValue" &&
      isCurrentSchema &&
      collectionTotal !== null
        ? `${schemaObjectCount}/${collectionTotal}`
        : schemaObjectCount;
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

    const serverObjectsKey = objectGroupKey(
      connectionId,
      driver,
      schema,
      "server-objects"
    );
    const virtualViewsKey = objectGroupKey(
      connectionId,
      driver,
      schema,
      "virtual-views"
    );

    const toggleObjectGroup = (key: string) => {
      setExpandedObjectGroupKeys((current) =>
        current.includes(key)
          ? current.filter((item) => item !== key)
          : [...current, key]
      );
    };

    const renderLoadMoreKeys = () =>
      isCurrentSchema &&
      activeCapabilities.dataModel === "keyValue" &&
      collectionNextCursor ? (
        <button
          type="button"
          className="wb-text-button ml-1 mt-1 h-6 px-2 text-[10px] text-[hsl(var(--wb-accent))]"
          disabled={isCollectionsLoading}
          onClick={() => void loadMoreCollections(connectionId, schema)}
        >
          {isCollectionsLoading
            ? "Loading…"
            : `Load next ${REDIS_KEY_PAGE_SIZE} keys`}
        </button>
      ) : null;

    const renderServerObjects = () => {
      if (!activeCapabilities.supportsFunctions) return null;
      const isExpanded = expandedObjectGroupKeys.includes(serverObjectsKey);

      return (
        <div>
          <button
            type="button"
            className="wb-tree-row w-full gap-1.5 px-0.5 hover:bg-[hsl(var(--wb-hover))]"
            onClick={() => toggleObjectGroup(serverObjectsKey)}
          >
            {isExpanded ? (
              <ChevronDown size={12} className="shrink-0 wb-muted" />
            ) : (
              <ChevronRight size={12} className="shrink-0 wb-muted" />
            )}
            <FolderCog size={12} className="shrink-0 text-sky-400/80" />
            <span className="truncate text-[11px] text-[hsl(var(--wb-text))]">
              Server Objects
            </span>
          </button>
          {isExpanded && (isCurrentSchema &&
          isFunctionsLoading &&
          schemaObjects.functions.length === 0 ? (
            <div className="pl-7 text-[11px] italic wb-muted">
              Loading routines...
            </div>
          ) : schemaObjects.functions.length === 0 ? (
            <div className="pl-7 text-[11px] italic wb-muted">
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
                  className="group ml-4 flex h-6 items-center gap-2 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                  title={`${signature} -> ${returnType}`}
                >
                  <Code2 size={12} className="shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">
                    {highlightMatch(routine.name, filterText)}
                  </span>
                  <span className="shrink-0 text-[9px] uppercase opacity-50">
                    {routineKindLabel(routine)}
                  </span>
                </div>
              );
            })
          ))}
        </div>
      );
    };

    const renderVirtualViews = () => {
      if (!canBrowseTables || !activeCapabilities.supportsViews) return null;
      const isExpanded = expandedObjectGroupKeys.includes(virtualViewsKey);

      return (
        <div>
          <button
            type="button"
            className="wb-tree-row w-full gap-1.5 px-0.5 hover:bg-[hsl(var(--wb-hover))]"
            onClick={() => toggleObjectGroup(virtualViewsKey)}
          >
            {isExpanded ? (
              <ChevronDown size={12} className="shrink-0 wb-muted" />
            ) : (
              <ChevronRight size={12} className="shrink-0 wb-muted" />
            )}
            <Folder size={12} className="shrink-0 text-violet-400/85" />
            <span className="truncate text-[11px] text-[hsl(var(--wb-text))]">
              virtual views
            </span>
            <span className="text-[9px] wb-muted">{virtualViews.length}</span>
          </button>
          {isExpanded &&
            (virtualViews.length === 0 ? (
              <div className="pl-7 text-[11px] italic wb-muted">No views found</div>
            ) : (
              virtualViews.map((view) => {
                const isSelectedView =
                  isCurrentSchema && selectedTable === view.name;
                return (
                  <ContextMenu key={`${schema}:view:${view.name}`}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={cn(
                          "group ml-4 flex h-6 cursor-pointer items-center gap-2 rounded-[3px] px-2 text-[11px]",
                          isSelectedView
                            ? "wb-tree-row-selected"
                            : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                        )}
                        onClick={() =>
                          void runForSchema(schema, () =>
                            handleTableSelect(view.name)
                          )
                        }
                        onDoubleClick={() =>
                          void handleTableDoubleClick(view, schema)
                        }
                      >
                        <TableProperties size={12} className="shrink-0 opacity-75" />
                        <span className="truncate">{view.name}</span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={menuContentClass}>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() => void handleTableDoubleClick(view, schema)}
                      >
                        Open Data
                      </ContextMenuItem>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          void runForSchema(schema, () => handleDdlClick(view))
                        }
                      >
                        Quick Documentation
                      </ContextMenuItem>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() => void copyText(view.name)}
                      >
                        Copy Name
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            ))}
        </div>
      );
    };

    const renderCollectionItem = (
      collection: CollectionInfo,
      label = collection.name,
      depth = 0
    ) => {
      const canDeleteCollection = Boolean(collectionDeleteSql(collection));
      const isSelectedCollection =
        isCurrentSchema && selectedTable === collection.name;

      return (
        <ContextMenu key={`${schema}:${collection.name}`}>
          <ContextMenuTrigger>
            <div
              className={cn(
                "group flex cursor-pointer select-none items-center gap-2 rounded-[3px] py-1 pr-2 text-[11px] transition-colors",
                isSelectedCollection
                  ? "wb-tree-row-selected"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]"
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
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
              <KeyRound
                size={12}
                className={cn(
                  "shrink-0 text-red-400/80",
                  isSelectedCollection && "opacity-100"
                )}
              />
              <span className="min-w-0 flex-1 truncate">
                {highlightMatch(label || "(empty)", filterText)}
              </span>
              {collection.type && (
                <span className="shrink-0 text-[9px] uppercase opacity-50">
                  {collection.type}
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
    };

    const renderRedisKeyNodes = (
      nodes: RedisKeyTreeNode<CollectionInfo>[],
      depth = 0
    ): ReactNode =>
      nodes.map((node) => {
        if (node.children.length === 0 && node.key) {
          return renderCollectionItem(node.key, node.segment, depth);
        }

        const key = objectGroupKey(
          connectionId,
          driver,
          schema,
          `redis:${node.path}`
        );
        const isExpanded = expandedObjectGroupKeys.includes(key);
        return (
          <div key={`redis-group:${node.path}`}>
            <button
              type="button"
              className="flex h-6 w-full items-center gap-1.5 rounded-[3px] pr-2 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              style={{ paddingLeft: `${6 + depth * 14}px` }}
              onClick={() => toggleObjectGroup(key)}
              title={node.path}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="shrink-0 wb-muted" />
              ) : (
                <ChevronRight size={12} className="shrink-0 wb-muted" />
              )}
              <Folder size={12} className="shrink-0 text-amber-400/80" />
              <span className="min-w-0 flex-1 truncate">
                {node.segment || "(empty)"}
              </span>
              <span className="shrink-0 text-[9px] tabular-nums wb-muted">
                {node.keyCount}
              </span>
            </button>
            {isExpanded && (
              <div>
                {node.key &&
                  renderCollectionItem(node.key, "(key)", depth + 1)}
                {renderRedisKeyNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      });

    return (
      <div
        className="ml-4 pb-1 pl-2"
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
            {activeCapabilities.dataModel === "keyValue" ? (
              <KeyRound size={12} className="shrink-0 text-red-400/85" />
            ) : (
              <Folder size={12} className="shrink-0 text-blue-400/85" />
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

        {isObjectGroupExpanded && (
          <>
            {activeCapabilities.dataModel === "keyValue" &&
              isCurrentSchema && (
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
              ) : schemaObjects.collections.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] wb-muted">
                  <div className="italic">
                    {collectionNextCursor
                      ? filterText
                        ? "No matching keys in this scan page"
                        : "No keys in this scan page"
                      : filterText
                        ? `No ${collectionLabelPlural.toLowerCase()} match "${filterText}"`
                        : `No ${collectionLabelPlural.toLowerCase()} found`}
                  </div>
                  {renderLoadMoreKeys()}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {activeCapabilities.dataModel === "keyValue"
                    ? renderRedisKeyNodes(
                        buildRedisKeyTree(schemaObjects.collections)
                      )
                    : schemaObjects.collections.map((collection) =>
                        renderCollectionItem(collection)
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
            ) : tableRelations.length === 0 ? (
              <div className="px-2 py-1.5 text-[11px] italic wb-muted">
                {filterText
                  ? `No tables match "${filterText}"`
                  : "No tables found"}
              </div>
            ) : (
              <div className="space-y-0.5">
                {tableRelations.map((table) => {
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
                          const metadata = await loadTableMetadata({
                            connectionId: activeConnectionId,
                            driver: activeDriver,
                            schema,
                            table: table.name,
                            includeIndexes:
                              activeCapabilities.supportsTableIndexes,
                            includeConstraints:
                              activeCapabilities.supportsTableConstraints,
                            force: true,
                          });
                          for (const tab of useTabStore.getState().tabs) {
                            if (
                              tab.type === "table" &&
                              tab.connectionId === activeConnectionId &&
                              tab.schemaName === schema &&
                              tab.tableName === table.name
                            ) {
                              setTableMetadata(tab.id, metadata);
                            }
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
                  <ContextMenuSeparator className={menuSeparatorClass} />

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

          </>
        )}
        {renderServerObjects()}
        {renderVirtualViews()}
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)]">
        <DatabaseExplorerHeader
          isLoading={isLoading}
          onRevealActive={handleRevealActiveConnection}
          onExpandActive={handleExpandActiveConnection}
          onCollapseAll={handleCollapseAll}
          onRefresh={() => void handleRefresh()}
          onHide={() => setToolWindowVisible("databaseExplorer", false)}
        />

        <DatabaseExplorerToolbar
          isLoading={isLoading}
          namespaceLabel={namespaceLabel}
          canCreateNamespace={activeCapabilities.supportsCreateDatabase}
          canCreateTable={Boolean(currentSchema && canBrowseTables)}
          canCreateView={Boolean(
            currentSchema && activeCapabilities.supportsViews
          )}
          isFilterVisible={isFilterVisible}
          onNewQueryConsole={handleNewQueryConsole}
          onNewDataSource={handleNewDataSource}
          onCreateNamespace={handleCreateDatabase}
          onCreateTable={handleCreateTable}
          onCreateView={handleCreateView}
          onRefresh={() => void handleRefresh()}
          onToggleFilter={() => setIsFilterVisible((visible) => !visible)}
        />
      </div>

      {isFilterVisible && (
        <div className="relative flex h-7 shrink-0 items-center border-b border-[hsl(var(--wb-border-subtle))] px-1.5">
          <Search
            size={12}
            className="pointer-events-none absolute left-2.5 wb-muted"
          />
          <input
            autoFocus
            value={filterText}
            onChange={(event) => setFilterText(event.target.value)}
            placeholder={
              activeCapabilities.dataModel === "keyValue"
                ? "Filter keys on server"
                : "Filter database objects"
            }
            className="h-6 w-full rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] pl-6 pr-6 text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
          />
          <button
            type="button"
            className="wb-icon-button absolute right-1.5 h-5 w-5"
            onClick={() => {
              setFilterText("");
              setIsFilterVisible(false);
            }}
            title="Close Filter"
          >
            <X size={11} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1 custom-scrollbar">
        <div className="space-y-0">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-8 text-center">
              <DatabaseBrandIcon
                driver={DEFAULT_DATABASE_DRIVER}
                size={24}
                className="mb-2 opacity-80"
              />
              <span className="text-[11px] font-medium text-[hsl(var(--wb-text))]">
                No data sources
              </span>
              <span className="mt-1 text-[10px] leading-4 wb-muted">
                Add a connection to browse schemas and objects.
              </span>
              <button
                type="button"
                className="wb-text-button mt-2 text-[hsl(var(--wb-accent))]"
                onClick={() => handleNewDataSource(DEFAULT_DATABASE_DRIVER)}
              >
                <Plus size={12} />
                Add data source
              </button>
            </div>
          ) : (
            connections.map((connection) => {
              const connectionColor = connectionTreeColor(
                connection.driver,
                connection.color
              );
              const isActive = connection.id === activeConnectionId;
              const isConnecting = connectingConnectionIds.includes(
                connection.id
              );
              const connectionMetadata = metadataForConnection(
                connection.id,
                connection.driver
              );
              const connectionSchemas = isActive
                ? schemaRows
                : connectionMetadata.schemas;
              const isConnectionExpanded =
                expandedConnectionIds.includes(connection.id);
              const isFlatKeyValueTree =
                defaultDatabaseCapabilities(connection.driver).dataModel ===
                "keyValue";
              const connectedPostgresDatabase =
                connection.driver === "postgres"
                  ? postgresConnectionDatabaseName(connection)
                  : "";
              const normalizedObjectFilter = filterText
                .trim()
                .toLocaleLowerCase();
              const renderedConnectionSchemas =
                isActive &&
                connection.driver === "postgres" &&
                normalizedObjectFilter &&
                !connectedPostgresDatabase
                  .toLocaleLowerCase()
                  .includes(normalizedObjectFilter)
                  ? connectionSchemas.filter((schema) => {
                      if (
                        schema
                          .toLocaleLowerCase()
                          .includes(normalizedObjectFilter)
                      ) {
                        return true;
                      }
                      const schemaObjects = schemaObjectsFor(
                        connection.id,
                        connection.driver,
                        schema
                      );
                      return (
                        schemaObjects.tables.length > 0 ||
                        schemaObjects.collections.length > 0 ||
                        schemaObjects.functions.length > 0
                      );
                    })
                  : connectionSchemas;

              return (
                  <div
                    id={`database-connection-${connection.id}`}
                    key={connection.id}
                    className="rounded-[3px] border border-transparent transition-colors"
                    style={connectionRegionStyle(connection.color, isActive)}
                  >
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                  <div
                    role="button"
                    tabIndex={0}
                    className={cn(
                      "flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] transition-colors",
	                      isActive
	                        ? "wb-tree-row-selected"
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
                    <ConnectionGlyph
                      driver={connection.driver}
                      icon={connection.icon}
                      size={14}
                      className="shrink-0"
                      style={{ color: connectionColor }}
                      title={`${databaseDriverProfile(connection.driver).capabilities.displayName} data source`}
                    />
                    <span className="truncate font-medium">
                      {connection.name}
                    </span>
                    <MetadataNodeBadge state={connectionMetadata.nodeState} />
                    {(isConnecting ||
                      (isActive &&
                        isFlatKeyValueTree &&
                        (isLoading || isCollectionsLoading))) && (
                      <RefreshCw
                        size={11}
                        className="ml-auto shrink-0 animate-spin wb-muted"
                        aria-label={
                          isConnecting
                            ? "Connecting to Redis"
                            : "Loading Redis keys"
                        }
                      />
                    )}
                    {isActive && activeCapabilities.dataModel === "keyValue" ? (
                      <span
                        className={cn(
                          "rounded-[3px] bg-[hsl(var(--wb-panel-raised))] px-1 text-[9px] wb-muted",
                          !isConnecting &&
                            !isLoading &&
                            !isCollectionsLoading &&
                            "ml-auto"
                        )}
                      >
                        db {currentSchema || connection.database || "0"}
                      </span>
                    ) : isActive ? (
                      renderSchemaVisibilityPicker()
                    ) : null}
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
                          {isFlatKeyValueTree && (
                            <ContextMenuItem
                              className={menuItemClass}
                              onClick={() => {
                                if (!isActive) {
                                  void setActiveConnection(connection.id).then(
                                    (error) => {
                                      if (!error) setIsCreateRedisKeyOpen(true);
                                    }
                                  );
                                  return;
                                }
                                setIsCreateRedisKeyOpen(true);
                              }}
                            >
                              Key
                            </ContextMenuItem>
                          )}
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
                        onClick={() =>
                          handleOpenConnectionProperties(connection.id)
                        }
                      >
                        Properties...
                      </ContextMenuItem>
                      <ContextMenuSeparator className={menuSeparatorClass} />
                      <ContextMenuItem
                        className={cn(menuItemClass, "text-destructive")}
                        onSelect={() => {
                          setDataSourceRemovalError(null);
                          setPendingDataSourceRemoval({
                            id: connection.id,
                            name: connection.name,
                          });
                        }}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Remove Data Source...
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>

                  {isConnectionExpanded && isFlatKeyValueTree ? (
                    <div className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pb-1 pl-2 pr-1">
                      {isActive && currentSchema ? (
                        renderSchemaObjects(
                          connection.id,
                          connection.driver,
                          currentSchema,
                          connectionColor
                        )
                      ) : (
                        <div className="flex items-center gap-1.5 px-1.5 py-1 text-[11px] italic wb-muted">
                          <RefreshCw size={11} className="animate-spin" />
                          Connecting and loading Redis metadata...
                        </div>
                      )}
                    </div>
                  ) : isConnectionExpanded ? (
                    <div className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pb-1 pl-2 pr-1">
                      <PostgresDatabaseTree
                        key={`${connection.id}:${
                          connection.driver === "postgres"
                            ? postgresDatabaseRefreshVersion
                            : 0
                        }:${isActive ? "active" : "inactive"}`}
                        enabled={
                          isActive &&
                          connection.driver === "postgres"
                        }
                        databases={
                          postgresDatabaseDiscovery.connectionId ===
                          connection.id
                            ? postgresDatabaseDiscovery.databases
                            : []
                        }
                        currentDatabase={
                          connectedPostgresDatabase
                        }
                        status={
                          postgresDatabaseDiscovery.connectionId ===
                          connection.id
                            ? postgresDatabaseDiscovery.status
                            : "idle"
                        }
                        error={
                          postgresDatabaseDiscovery.connectionId ===
                          connection.id
                            ? postgresDatabaseDiscovery.error
                            : null
                        }
                        schemaCount={
                          isActive
                            ? schemaCountLabel
                            : String(connectionSchemas.length)
                        }
                        connectionColor={connectionColor}
                        visibleDatabases={
                          isActive && connection.driver === "postgres"
                            ? visiblePostgresDatabases
                            : undefined
                        }
                        filterText={
                          connection.driver === "postgres" ? filterText : ""
                        }
                        databaseMatchesFilter={(database, normalizedFilter) =>
                          postgresDatabaseMatchesFilter(
                            connection.id,
                            database,
                            connectedPostgresDatabase,
                            normalizedFilter
                          )
                        }
                        onLoadDatabase={
                          isActive && connection.driver === "postgres"
                            ? async (database) => {
                                if (
                                  !useConnectionStore
                                    .getState()
                                    .connectedConnectionIds.includes(
                                      connection.id
                                    )
                                ) {
                                  const connectionError = await setActiveConnection(
                                    connection.id
                                  );
                                  if (connectionError) {
                                    throw new Error(connectionError);
                                  }
                                }
                                await loadPostgresRemoteDatabase(
                                  connection.id,
                                  database
                                );
                              }
                            : undefined
                        }
                        renderDatabaseChildren={(database) =>
                          database === connectedPostgresDatabase ? null : (
                            <PostgresRemoteDatabaseContents
                              connectionId={connection.id}
                              database={database}
                              schemas={
                                postgresRemoteDatabases.connectionId ===
                                connection.id
                                  ? postgresRemoteDatabases.schemas[database] ||
                                    []
                                  : []
                              }
                              connectionColor={connectionColor}
                              filterText={
                                database
                                  .toLocaleLowerCase()
                                  .includes(
                                    filterText.trim().toLocaleLowerCase()
                                  )
                                  ? ""
                                  : filterText
                              }
                              onTablesLoaded={(schema, databaseTables) =>
                                handlePostgresRemoteTablesLoaded(
                                  connection.id,
                                  database,
                                  schema,
                                  databaseTables
                                )
                              }
                              onOpenTable={(
                                databaseName,
                                schema,
                                table
                              ) =>
                                handlePostgresRemoteTableOpen(
                                  connection.id,
                                  databaseName,
                                  schema,
                                  table
                                )
                              }
                            />
                          )
                        }
                      >
                      {(connectionMetadata.isLoading ||
                        connectionMetadata.nodeState?.status === "loading") &&
                      connectionSchemas.length === 0 ? (
                        <div className="px-1.5 py-1 text-[11px] italic wb-muted">
                          Loading {namespaceLabelPlural}...
                        </div>
                      ) : renderedConnectionSchemas.length === 0 ? (
                        <div className="px-1.5 py-1 text-[11px] italic wb-muted">
                          {normalizedObjectFilter
                            ? `No ${namespaceLabelPlural} match “${filterText.trim()}”`
                            : `No ${namespaceLabelPlural} found`}
                        </div>
                      ) : (
                        renderedConnectionSchemas.map((schema) => {
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
                                    <Network
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
                      </PostgresDatabaseTree>
                    </div>
                  ) : null}
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

      <DataSourceDialog
        open={isDataSourceDialogOpen}
        onOpenChange={setIsDataSourceDialogOpen}
      />
      <Dialog
        open={Boolean(pendingDataSourceRemoval)}
        onOpenChange={(open) => {
          if (!open && !isRemovingDataSource) {
            setPendingDataSourceRemoval(null);
            setDataSourceRemovalError(null);
          }
        }}
      >
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] gap-4 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-5 text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Remove data source?</DialogTitle>
            <DialogDescription className="text-[12px] leading-5 wb-muted">
              Remove <strong>{pendingDataSourceRemoval?.name}</strong> from
              OxideStudio. This deletes the saved connection configuration and
              cached metadata, but does not delete the remote database.
            </DialogDescription>
          </DialogHeader>
          {dataSourceRemovalError && (
            <div className="rounded-[4px] bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {dataSourceRemovalError}
            </div>
          )}
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="ghost"
              disabled={isRemovingDataSource}
              onClick={() => setPendingDataSourceRemoval(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isRemovingDataSource}
              onClick={() => void handleRemoveDataSource()}
            >
              {isRemovingDataSource ? "Removing..." : "Remove Data Source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreateDatabaseDialog
        isOpen={isCreateDbDialogOpen}
        onClose={() => setIsCreateDbDialogOpen(false)}
        activeConnectionId={activeConnectionId || ""}
        onCreated={(schema) => {
          if (!activeConnectionId) return;
          if (activeDriver === "postgres") return;
          const schemaKey = schemaTreeKey(
            activeConnectionId,
            activeDriver,
            schema
          );
          const objectsKey = objectGroupKey(
            activeConnectionId,
            activeDriver,
            schema,
            "objects"
          );
          setExpandedConnectionIds((current) =>
            current.includes(activeConnectionId)
              ? current
              : [...current, activeConnectionId]
          );
          setExpandedSchemaKeys((current) =>
            current.includes(schemaKey) ? current : [...current, schemaKey]
          );
          setExpandedObjectGroupKeys((current) =>
            current.includes(objectsKey) ? current : [...current, objectsKey]
          );
        }}
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
      <RedisKeyDialog
        open={isCreateRedisKeyOpen}
        database={collectionNamespace || "0"}
        onOpenChange={setIsCreateRedisKeyOpen}
        onCreate={(draft, command) =>
          handleCreateRedisKey(draft.name, command)
        }
      />
    </div>
  );
}
