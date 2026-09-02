import { cn } from "@/lib/utils";
import { isLoginUserSchema } from "@/lib/loginUserSchema";
import {
  APP_EVENT_OPEN_DATABASE_SEARCH,
  APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
  APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
  APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
  type TableCsvImportRequest,
  type TableJsonImportRequest,
  type TableXlsxImportRequest,
} from "@/lib/actionEvents";
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
  Upload,
  TableProperties,
  Code2,
  Trash2,
  Clipboard,
  Folder,
  FolderCog,
  Network,
  Search,
  X,
  GitCompareArrows,
  ArrowRightLeft,
  ListChecks,
  AlertTriangle,
  ShieldCheck,
  Wrench,
  ArchiveRestore,
  Sparkles,
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
import {
  useConnectionStore,
  type ConnectionRuntimeState,
} from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  APP_EVENT_OPEN_ASSISTANT,
  useAssistantComposerStore,
} from "@/store/useAssistantComposerStore";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  parseDatabaseObjectNavigationKey,
  parseDatabaseSchemaNavigationKey,
  useDatabaseNavigationStore,
} from "@/lib/databaseNavigation";
import { isExplorerRefreshShortcut } from "@/lib/keybindings";
import { useTableOperations } from "@/hooks/useTableOperations";
import {
  databaseService,
  queryService,
  schemaService,
  tableService,
} from "@/services/tauri";
import {
  invalidateRoutineSourceCache,
  loadPostgresRoutineDefinitions,
} from "@/services/routineSourceCache";
import { loadTableDdl, loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  CollectionInfo,
  DatabaseCapabilities,
  DatabaseDriver,
  FunctionInfo,
  NacosConfigLocation,
  SchemaObjectInfo,
  TableDataTransferEndpoint,
  TableInfo,
  SearchIndexClearResult,
  SearchIndexMetadataKind,
} from "@/services/tauri/types";
import { useSqlScriptImportController } from "@/features/sql-script-import";
import type {
  DatabaseMaintenanceTarget,
  SqliteBackupTarget,
} from "@/features/database-admin";
import {
  DEFAULT_DATABASE_DRIVER,
  databaseDriverProfile,
  defaultDatabaseCapabilities,
  defaultDatabaseName,
  defaultDatabasePort,
  isMaterializedViewObject,
  isReadOnlyRelationObject,
  isViewObject,
  normalizeDatabaseDriverName,
  pluralizeNamespaceLabel,
  relationObjectLabel,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import {
  collectionCreateQueryTemplateForCapabilities,
  collectionDisplayLabelForCapabilities,
  collectionDeleteQueryTemplateForCapabilities,
  databaseObjectPreviewProvider,
  collectionPreviewQueryTemplateForCapabilities,
  collectionPreviewTabTitleForCapabilities,
} from "@/lib/databaseObjectPreview";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  lazy,
  Suspense,
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
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";
import {
  routineCallTemplate,
  routineKind,
  routineKindLabel,
  routineSignature,
} from "@/features/database-explorer/model/routinePresentation";
import {
  composeTableBatchDdl,
  formatTableBatchNamesForClipboard,
  MAX_EXPLORER_TABLE_BATCH_SELECTION,
  pruneTableBatchSelection,
  settleTableBatchWork,
  summarizeTableBatchFailures,
  toggleAllVisibleTableBatchSelection,
  toggleTableBatchSelection,
  type TableBatchFailureDetail,
  type TableBatchSelection,
} from "@/features/database-explorer/model/tableBatchSelection";
import {
  createExplorerTableReferencePayload,
  explorerTableReferenceDragLabel,
} from "@/features/query-editor/model/explorerTableReferenceDrop";
import { beginExplorerTableReferenceDrag } from "@/features/query-editor/model/explorerTableReferenceDrag";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "@/features/database-explorer/model/explorerActivation";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import {
  collapsedDatabaseSchemaTargets,
  collapsedSchemaMetadataTargets,
  runSidebarSearchTasks,
} from "@/features/database-explorer/model/sidebarSearchTasks";
import { searchIndexClearTouched } from "@/features/database-explorer/model/elasticsearchIndexActions";
import {
  captureLiveSchemaSnapshot,
  type SchemaSnapshotIdentity,
} from "@/services/schemaSnapshotStore";
import {
  connectionCatalogDatabaseName,
  PostgresDatabaseTree,
} from "./PostgresDatabaseTree";
import { PostgresRemoteDatabaseContents } from "./PostgresRemoteDatabaseContents";
import { PostgresDatabaseVisibilitySection } from "./PostgresDatabaseVisibilitySection";
import { usePostgresDatabaseDiscovery } from "@/hooks/usePostgresDatabaseDiscovery";
import { buildRedisKeyTree, type RedisKeyTreeNode } from "@/lib/redisKey";
import { SqlScriptImportDialog } from "./SqlScriptImportDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const DataSourceDialog = lazy(() =>
  import("./DataSourceDialog").then((module) => ({
    default: module.DataSourceDialog,
  })),
);
const SchemaSnapshotDialog = lazy(() =>
  import("./SchemaSnapshotDialog").then((module) => ({
    default: module.SchemaSnapshotDialog,
  })),
);
const CreateDatabaseDialog = lazy(() =>
  import("./CreateDatabaseDialog").then((module) => ({
    default: module.CreateDatabaseDialog,
  })),
);
const RenameTableDialog = lazy(() =>
  import("./RenameTableDialog").then((module) => ({
    default: module.RenameTableDialog,
  })),
);
const DdlViewerDialog = lazy(() =>
  import("./DdlViewerDialog").then((module) => ({
    default: module.DdlViewerDialog,
  })),
);
const EditColumnsDialog = lazy(() =>
  import("./EditColumnsDialog").then((module) => ({
    default: module.EditColumnsDialog,
  })),
);
const CreateViewDialog = lazy(() =>
  import("./CreateViewDialog").then((module) => ({
    default: module.CreateViewDialog,
  })),
);
const RedisKeyDialog = lazy(() =>
  import("./RedisKeyDialog").then((module) => ({
    default: module.RedisKeyDialog,
  })),
);
const DatabaseAdministrationDialog = lazy(() =>
  import("@/features/database-admin").then((module) => ({
    default: module.DatabaseAdministrationDialog,
  })),
);
const ElasticsearchIndexMetadataDialog = lazy(() =>
  import("@/features/database-explorer/ui/ElasticsearchIndexMetadataDialog").then(
    (module) => ({
      default: module.ElasticsearchIndexMetadataDialog,
    }),
  ),
);
const ElasticsearchIndexClearDialog = lazy(() =>
  import("@/features/database-explorer/ui/ElasticsearchIndexClearDialog").then(
    (module) => ({
      default: module.ElasticsearchIndexClearDialog,
    }),
  ),
);
const DatabaseMaintenanceDialog = lazy(() =>
  import("@/features/database-admin").then((module) => ({
    default: module.DatabaseMaintenanceDialog,
  })),
);
const SqliteBackupDialog = lazy(() =>
  import("@/features/database-admin").then((module) => ({
    default: module.SqliteBackupDialog,
  })),
);
const TableDataTransferDialog = lazy(() =>
  import("./TableDataTransferDialog").then((module) => ({
    default: module.TableDataTransferDialog,
  })),
);
const MongoCollectionTransferDialog = lazy(() =>
  import("./MongoCollectionTransferDialog").then((module) => ({
    default: module.MongoCollectionTransferDialog,
  })),
);
const TableDataCompareDialog = lazy(() =>
  import("./TableDataCompareDialog").then((module) => ({
    default: module.TableDataCompareDialog,
  })),
);
const NacosConfigTransferDialog = lazy(() =>
  import("./NacosConfigTransferDialog").then((module) => ({
    default: module.NacosConfigTransferDialog,
  })),
);

interface PostgresRemoteDatabaseState {
  connectionId: string | null;
  schemas: Record<string, string[]>;
  tables: Record<string, Record<string, TableInfo[]>>;
  objects: Record<string, Record<string, SchemaObjectInfo[]>>;
}

interface ExplorerDataTransferRequest {
  source: TableDataTransferEndpoint;
  sourceCapabilities: DatabaseCapabilities;
  initialSourceScope: "table" | "schema" | "database";
  sourceSchemas: string[];
  initialSourceTables?: string[];
  initialTarget?: Omit<TableDataTransferEndpoint, "table">;
}

interface ExplorerDataCompareRequest {
  source: TableDataTransferEndpoint;
  sourceTables: string[];
  sourceCapabilities: DatabaseCapabilities;
}

interface ExplorerMongoCollectionTransferRequest {
  sourceConnectionId: string;
  sourceConnectionName: string;
  sourceDatabase: string;
  sourceCollection: string;
}

interface ExplorerNacosConfigTransferRequest {
  sourceConnectionId: string;
  sourceConnectionName: string;
  source: NacosConfigLocation;
}

function nacosLocationFromCollection(
  collection: CollectionInfo,
): NacosConfigLocation | null {
  try {
    const key = JSON.parse(collection.name) as {
      dataId?: unknown;
      group?: unknown;
      tenant?: unknown;
    };
    if (
      typeof key.dataId !== "string" ||
      !key.dataId.trim() ||
      typeof key.group !== "string" ||
      !key.group.trim() ||
      (key.tenant !== undefined && typeof key.tenant !== "string")
    ) {
      return null;
    }
    return { dataId: key.dataId, group: key.group, tenant: key.tenant || "" };
  } catch {
    return null;
  }
}

interface ExplorerTableBatchSelection extends TableBatchSelection {
  scopeKey: string;
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
  mariadb: "#c0765a",
  redis: "#d95b5b",
  elasticsearch: "#d6ad5b",
  mongodb: "#5fb878",
};

function connectionTreeColor(
  driver: string | null | undefined,
  color?: string,
) {
  return color || DRIVER_TREE_COLORS[driver || ""] || "#75a7ff";
}

function supportsDatabaseCatalogTree(
  driver: DatabaseDriver | null | undefined,
) {
  return Boolean(
    driver && defaultDatabaseCapabilities(driver).supportsDatabaseCatalogs,
  );
}

function supportsDatabaseAdministration(
  driver: DatabaseDriver | null | undefined,
) {
  return driver === "postgres" || driver === "mysql" || driver === "mariadb";
}

function connectionRegionStyle(
  color: string | undefined,
  active: boolean,
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
  schema: string,
) {
  return `${connectionId}:${driver || "unknown"}:${schema}`;
}

function objectGroupKey(
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
  group: string,
) {
  return `${connectionId}:${driver || "unknown"}:${schema}:${group}`;
}

function tableTreeKey(
  connectionId: string,
  driver: string | null | undefined,
  databaseName: string | undefined,
  schema: string,
  table: string,
) {
  return JSON.stringify([
    connectionId,
    driver || "unknown",
    databaseName || "",
    schema,
    table,
  ]);
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
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
        title={state.message || "Metadata refresh failed"}
        aria-label="Metadata refresh failed"
      />
    );
  }

  if (state.status === "stale") {
    return (
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/80"
        title={state.message || "Metadata may be stale"}
        aria-label="Cached metadata may be stale"
      />
    );
  }

  return null;
}

function ConnectionRuntimeBadge({
  runtime,
  isConnected,
  isConnecting,
}: {
  runtime?: ConnectionRuntimeState;
  isConnected: boolean;
  isConnecting: boolean;
}) {
  if (isConnecting || runtime?.status === "connecting") {
    return (
      <RefreshCw
        size={10}
        className="shrink-0 animate-spin text-[hsl(var(--wb-text-muted))]"
        aria-label="Connecting"
      />
    );
  }
  if (runtime?.status === "error") {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-red-500 ring-1 ring-red-500/25"
        title={runtime.message || "Connection failed"}
        aria-label="Connection failed"
      />
    );
  }
  if (isConnected || runtime?.status === "connected") {
    return (
      <span
        className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 ring-1 ring-emerald-400/25"
        title="Connected"
        aria-label="Connected"
      />
    );
  }
  return null;
}

function isEditableExplorerShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

export function SchemaSidebar() {
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const connections = useConnectionStore((state) => state.connections);
  const connectionDisplayCache = useConnectionStore(
    (state) => state.connectionDisplayCache,
  );
  const hasConnectionDisplayCache = useConnectionStore(
    (state) => state.hasConnectionDisplayCache,
  );
  const connectionsLoading = useConnectionStore((state) => state.isLoading);
  const connectionLoadError = useConnectionStore((state) => state.loadError);
  const loadConnections = useConnectionStore((state) => state.loadConnections);
  const connectedConnectionIds = useConnectionStore(
    (state) => state.connectedConnectionIds,
  );
  const connectionRuntimeStates = useConnectionStore(
    (state) => state.connectionRuntimeStates,
  );
  const setActiveConnection = useConnectionStore(
    (state) => state.setActiveConnection,
  );
  const createNewConnection = useConnectionStore(
    (state) => state.createNewConnection,
  );
  const updateConnectionConfig = useConnectionStore(
    (state) => state.updateConnectionConfig,
  );
  const selectConnection = useConnectionStore(
    (state) => state.selectConnection,
  );
  const removeConnection = useConnectionStore(
    (state) => state.removeConnection,
  );
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (store) => store.setToolWindowVisible,
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
    metadataVersion,
  } = useSchemaStore();

  const connectionAvailabilityKey = useMemo(
    () => connections.map((connection) => connection.id).join("|"),
    [connections],
  );
  const [filterText, setFilterText] = useState("");
  const [schemaObjectDescriptors, setSchemaObjectDescriptors] = useState<
    SchemaObjectInfo[]
  >([]);
  const [schemaObjectDescriptorScope, setSchemaObjectDescriptorScope] =
    useState<string | null>(null);
  const [
    isSchemaObjectDescriptorsLoading,
    setIsSchemaObjectDescriptorsLoading,
  ] = useState(false);
  const [expandedSchemaObjectMemberKeys, setExpandedSchemaObjectMemberKeys] =
    useState<string[]>([]);
  const [schemaObjectMemberStates, setSchemaObjectMemberStates] = useState<
    Record<
      string,
      { loading: boolean; error: boolean; members: SchemaObjectInfo[] }
    >
  >({});
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [isDataSourceDialogOpen, setIsDataSourceDialogOpen] = useState(false);
  const [isCreateDbDialogOpen, setIsCreateDbDialogOpen] = useState(false);
  const [isCreateViewDialogOpen, setIsCreateViewDialogOpen] = useState(false);
  const [isCreateRedisKeyOpen, setIsCreateRedisKeyOpen] = useState(false);
  const [
    databaseAdministrationConnectionId,
    setDatabaseAdministrationConnectionId,
  ] = useState<string | null>(null);
  const [databaseMaintenanceTarget, setDatabaseMaintenanceTarget] =
    useState<DatabaseMaintenanceTarget | null>(null);
  const [sqliteBackupTarget, setSqliteBackupTarget] =
    useState<SqliteBackupTarget | null>(null);
  const [connectingConnectionIds, setConnectingConnectionIds] = useState<
    string[]
  >([]);
  const [viewDialogMode, setViewDialogMode] = useState<"create" | "edit">(
    "create",
  );
  const [viewDialogKind, setViewDialogKind] = useState<
    "view" | "materializedView"
  >("view");
  const [viewDialogInitialName, setViewDialogInitialName] = useState("");
  const [viewDialogInitialSql, setViewDialogInitialSql] = useState("");
  const [isTablesHovered, setIsTablesHovered] = useState(false);
  const [schemaPickerOpen, setSchemaPickerOpen] = useState(false);
  const [schemaVisibilityKey, setSchemaVisibilityKey] = useState<string | null>(
    null,
  );
  const [showAllSchemas, setShowAllSchemas] = useState(false);
  const [visibleSchemaNames, setVisibleSchemaNames] = useState<string[]>([]);
  const [expandedConnectionIds, setExpandedConnectionIds] = useState<string[]>(
    [],
  );
  const [expandedSchemaKeys, setExpandedSchemaKeys] = useState<string[]>([]);
  const [expandedObjectGroupKeys, setExpandedObjectGroupKeys] = useState<
    string[]
  >([]);
  const [expandedTableKeys, setExpandedTableKeys] = useState<string[]>([]);
  const suppressTableReferenceClickRef = useRef(false);

  // Programmatic activation (startup cache, Search Everywhere, AI navigation)
  // should expose the same tree state as a direct row click. Paint cached
  // metadata immediately while the remote session is still connecting.
  useEffect(() => {
    if (!activeConnectionId) return;
    setExpandedConnectionIds((current) =>
      current.includes(activeConnectionId) ? current : [activeConnectionId],
    );
  }, [activeConnectionId]);
  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest,
  );
  const clearDatabaseReveal = useDatabaseNavigationStore(
    (state) => state.clearReveal,
  );
  const [postgresDatabaseRefreshVersion, setPostgresDatabaseRefreshVersion] =
    useState(0);
  const postgresRemoteRefreshVersionRef = useRef(0);
  const [postgresRemoteRefreshRequest, setPostgresRemoteRefreshRequest] =
    useState<{
      connectionId: string;
      database: string;
      version: number;
      schema?: string;
    } | null>(null);
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
      objects: {},
    });
  const postgresRemoteRequestIds = useRef<Record<string, number>>({});
  const postgresRemoteRequestCounter = useRef(0);
  const postgresRemoteContextVersion = useRef(0);
  const postgresGlobalSearchGenerationRef = useRef(0);
  const routineSourceMetadataVersionRef = useRef(metadataVersion);

  // Context Menu State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [ddlViewerOpen, setDdlViewerOpen] = useState(false);
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [elasticsearchMetadataTarget, setElasticsearchMetadataTarget] =
    useState<{
      connectionId: string;
      driver: string;
      index: string;
      kind: SearchIndexMetadataKind;
    } | null>(null);
  const [elasticsearchClearTarget, setElasticsearchClearTarget] = useState<{
    connectionId: string;
    driver: string;
    schema: string;
    index: string;
  } | null>(null);
  const [activeTable, setActiveTable] = useState("");
  const [activeTableType, setActiveTableType] = useState<string | null>(null);
  const [ddlContent, setDdlContent] = useState("");
  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const {
    pendingImport: pendingSqlScriptImport,
    isImporting: isSqlScriptImporting,
    requestImport: requestSqlScriptImport,
    confirmImport: handleConfirmSqlScriptImport,
    closeImport: closeSqlScriptImport,
  } = useSqlScriptImportController({
    availabilityKey: connectionAvailabilityKey,
    isTargetAvailable: (target) =>
      connections.some((connection) => connection.id === target.connectionId),
    ensureTargetReady: async (target) => {
      const connectionError = await setActiveConnection(target.connectionId);
      if (connectionError) throw new Error(connectionError);
    },
    refreshMetadata: async (target) => {
      bumpMetadataVersion();
      const connection = connections.find(
        (candidate) => candidate.id === target.connectionId,
      );
      const configuredDatabase =
        connection && supportsDatabaseCatalogTree(target.driver)
          ? connectionCatalogDatabaseName(connection)
          : undefined;
      if (target.database && target.database !== configuredDatabase) {
        setPostgresDatabaseRefreshVersion((version) => version + 1);
        return;
      }
      await loadSchemas(target.connectionId, true);
      if (target.schema) {
        await loadTables(target.connectionId, target.schema, true);
      }
    },
    onError: (message, phase) => {
      setNamespaceError(
        phase === "preview"
          ? message
          : phase === "refresh"
            ? `SQL import completed; metadata refresh failed: ${message}`
            : `SQL import failed: ${message}`,
      );
    },
  });
  const [pendingDataSourceRemoval, setPendingDataSourceRemoval] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isRemovingDataSource, setIsRemovingDataSource] = useState(false);
  const [dataSourceRemovalError, setDataSourceRemovalError] = useState<
    string | null
  >(null);
  const [schemaSnapshotIdentity, setSchemaSnapshotIdentity] =
    useState<SchemaSnapshotIdentity | null>(null);
  const [schemaDiagramLoadingKey, setSchemaDiagramLoadingKey] = useState<
    string | null
  >(null);
  const [dataTransferRequest, setDataTransferRequest] =
    useState<ExplorerDataTransferRequest | null>(null);
  const [mongoCollectionTransferRequest, setMongoCollectionTransferRequest] =
    useState<ExplorerMongoCollectionTransferRequest | null>(null);
  const [dataCompareRequest, setDataCompareRequest] =
    useState<ExplorerDataCompareRequest | null>(null);
  const [nacosConfigTransferRequest, setNacosConfigTransferRequest] =
    useState<ExplorerNacosConfigTransferRequest | null>(null);
  const [tableBatchSelection, setTableBatchSelection] =
    useState<ExplorerTableBatchSelection | null>(null);
  const [tableBatchAction, setTableBatchAction] = useState<{
    scopeKey: string;
    running: boolean;
    message: string;
    cancelId?: string;
    failures?: TableBatchFailureDetail[];
    omittedFailures?: number;
  } | null>(null);
  const [connectionCapabilities, setConnectionCapabilities] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
  } | null>(null);
  // Runtime package activation changes the capability contract without
  // changing the saved connection id. Subscribe so the Explorer refreshes its
  // tree, catalog controls, and object actions in place.
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
  const databaseExplorerSettings = useSettingsStore(
    (store) => store.settings.databaseExplorer,
  );
  const tableTabReuseMode = useSettingsStore(
    (store) => store.settings.dataGrid.tableTabReuseMode,
  );
  const shouldAutoIntrospect =
    databaseExplorerSettings.refreshMode === "cache-first";
  const shouldLimitVisibleSchemas =
    databaseExplorerSettings.showOnlySelectedSchemas;
  const explorerActivationMode = databaseExplorerSettings.activationMode;
  const showExplorerHoverTooltips =
    databaseExplorerSettings.showHoverTooltips;

  const {
    truncateTable,
    dropTable,
    renameTable,
    exportTableData,
    activeTableExport,
    cancelActiveTableExport,
    importTableData,
    getTableDdl,
    getViewDefinition,
    refreshMaterializedView,
  } = useTableOperations();

  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const isActiveConnectionReady = Boolean(
    activeConnectionId && connectedConnectionIds.includes(activeConnectionId),
  );
  const activeDriver = activeConnection?.driver || DEFAULT_DATABASE_DRIVER;
  useEffect(() => {
    if (routineSourceMetadataVersionRef.current === metadataVersion) return;
    routineSourceMetadataVersionRef.current = metadataVersion;
    if (!activeConnectionId || !activeConnection) return;
    invalidateRoutineSourceCache({
      projectId: activeProjectId || "local",
      connectionId: activeConnectionId,
      driver: activeConnection.driver,
      driverPackageVersion: activeConnection.driverPackageVersion,
      connectionDatabaseName: activeConnection.database,
    });
  }, [activeConnection, activeConnectionId, activeProjectId, metadataVersion]);
  const activeCapabilities =
    connectionCapabilities &&
    connectionCapabilities.connectionId === activeConnectionId &&
    connectionCapabilities.capabilities.driver === activeDriver
      ? connectionCapabilities.capabilities
      : defaultDatabaseCapabilities(activeDriver);
  const canBrowseDatabaseCatalogs = Boolean(
    activeCapabilities.supportsDatabaseCatalogs,
  );
  const postgresDatabaseDiscovery = usePostgresDatabaseDiscovery({
    projectId: activeProjectId,
    connectionId: activeConnectionId,
    driver: activeConnection?.driver,
    driverPackageVersion: activeConnection?.driverPackageVersion,
    connectionDatabaseName: activeConnection?.database,
    canBrowseDatabaseCatalogs,
    isConnectionReady: isActiveConnectionReady,
    refreshVersion: postgresDatabaseRefreshVersion,
  });
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
            "objects",
          ),
        )
      : expandedSchemaKeys.includes(
          schemaTreeKey(activeConnectionId, activeDriver, currentSchema),
        )),
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
    activeConnection && canBrowseDatabaseCatalogs
      ? connectionCatalogDatabaseName(activeConnection)
      : "";
  const postgresDatabaseRows = useMemo(() => {
    const discoveredDatabases =
      postgresDatabaseDiscovery.connectionId === activeConnectionId
        ? postgresDatabaseDiscovery.databases
        : [];
    return [
      ...(activePostgresDatabase ? [activePostgresDatabase] : []),
      ...discoveredDatabases.filter(
        (database) => database !== activePostgresDatabase,
      ),
    ].filter(
      (database, index, rows) =>
        Boolean(database) && rows.indexOf(database) === index,
    );
  }, [
    activeConnectionId,
    activePostgresDatabase,
    postgresDatabaseDiscovery.connectionId,
    postgresDatabaseDiscovery.databases,
  ]);
  const postgresDatabaseVisibilityStorageKey =
    activeConnectionId && canBrowseDatabaseCatalogs
      ? `oxide-studio-visible-databases:${activeProjectId}:${activeConnectionId}`
      : null;
  const visiblePostgresDatabaseSet = useMemo(
    () => new Set(visiblePostgresDatabaseNames),
    [visiblePostgresDatabaseNames],
  );
  const visiblePostgresDatabases = useMemo(
    () =>
      showAllPostgresDatabases
        ? postgresDatabaseRows
        : postgresDatabaseRows.filter((database) =>
            visiblePostgresDatabaseSet.has(database),
          ),
    [
      postgresDatabaseRows,
      showAllPostgresDatabases,
      visiblePostgresDatabaseSet,
    ],
  );
  const postgresDatabaseCountLabel = showAllPostgresDatabases
    ? `${postgresDatabaseRows.length} db`
    : `${visiblePostgresDatabases.length} of ${postgresDatabaseRows.length} db`;
  const preferredVisibleSchema =
    [currentSchema, defaultSchema, activeConnection?.database, schemas[0]].find(
      (schema): schema is string =>
        Boolean(schema && (schemas.length === 0 || schemas.includes(schema))),
    ) || null;
  const visibleSchemaSet = useMemo(
    () => new Set(visibleSchemaNames),
    [visibleSchemaNames],
  );
  const schemaRows = useMemo(() => {
    if (schemas.length === 0) {
      return currentSchema ? [currentSchema] : [];
    }

    // Catalog-aware drivers own schema visibility beneath their database
    // nodes, rather than through the connection-wide schema picker.
    if (canBrowseDatabaseCatalogs) return schemas;

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
    canBrowseDatabaseCatalogs,
    currentSchema,
    preferredVisibleSchema,
    schemas,
    shouldLimitVisibleSchemas,
    showAllSchemas,
    visibleSchemaSet,
  ]);
  const schemaCountLabel =
    canBrowseDatabaseCatalogs || showAllSchemas || !shouldLimitVisibleSchemas
      ? String(schemas.length)
      : `${schemaRows.length} of ${schemas.length}`;
  const metadataForConnection = (
    connectionId: string,
    driver?: string | null,
  ) => {
    const isActiveConnection = connectionId === activeConnectionId;
    const snapshot =
      connectionSnapshots[
        getConnectionMetadataSnapshotKey(connectionId, driver)
      ];

    return {
      isActiveConnection,
      schemas: isActiveConnection ? schemas : (snapshot?.schemas ?? []),
      currentSchema: isActiveConnection
        ? currentSchema
        : (snapshot?.currentSchema ?? null),
      defaultSchema: isActiveConnection
        ? defaultSchema
        : (snapshot?.defaultSchema ?? null),
      selectedTable: isActiveConnection
        ? selectedTable
        : (snapshot?.selectedTable ?? null),
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
      (schema) => schemas.length === 0 || schemas.includes(schema),
    );
    setShowAllSchemas(showAll);
    setVisibleSchemaNames(normalizedNames);

    if (!schemaVisibilityStorageKey) return;

    try {
      localStorage.setItem(
        schemaVisibilityStorageKey,
        JSON.stringify({ all: showAll, schemas: normalizedNames }),
      );
    } catch (error) {
      console.warn("Failed to persist visible schemas", error);
    }
  };

  const handleToggleAllSchemas = (checked: boolean | "indeterminate") => {
    const nextChecked = checked === true;
    updateVisibleSchemas(
      nextChecked,
      nextChecked
        ? schemas
        : preferredVisibleSchema
          ? [preferredVisibleSchema]
          : [],
    );
  };

  const handleToggleSchemaVisibility = (
    schema: string,
    checked: boolean | "indeterminate",
  ) => {
    const nextChecked = checked === true;

    if (showAllSchemas && !nextChecked) {
      updateVisibleSchemas(
        false,
        schemas.filter((item) => item !== schema),
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
    names: string[],
  ) => {
    const normalizedNames = Array.from(new Set(names)).filter(
      (database) =>
        postgresDatabaseRows.length === 0 ||
        postgresDatabaseRows.includes(database),
    );
    setShowAllPostgresDatabases(showAll);
    setVisiblePostgresDatabaseNames(normalizedNames);

    if (!postgresDatabaseVisibilityStorageKey) return;
    try {
      localStorage.setItem(
        postgresDatabaseVisibilityStorageKey,
        JSON.stringify({ all: showAll, databases: normalizedNames }),
      );
    } catch (error) {
      console.warn("Failed to persist visible PostgreSQL databases", error);
    }
  };

  const handleToggleAllPostgresDatabases = (
    checked: boolean | "indeterminate",
  ) => {
    const nextChecked = checked === true;
    updateVisiblePostgresDatabases(
      nextChecked,
      nextChecked ? postgresDatabaseRows : [],
    );
  };

  const handleTogglePostgresDatabaseVisibility = (
    database: string,
    checked: boolean | "indeterminate",
  ) => {
    const nextChecked = checked === true;
    if (showAllPostgresDatabases && !nextChecked) {
      updateVisiblePostgresDatabases(
        false,
        postgresDatabaseRows.filter((item) => item !== database),
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
    if (!isViewObject(table.type) || isMaterializedViewObject(table.type))
      return;
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
      `Empty all rows from "${table.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;
    await truncateTable(table.name);
  };

  const handleDropClick = async (table: TableInfo) => {
    const label = relationObjectLabel(table.type).toLowerCase();
    const confirmed = window.confirm(
      `Drop ${label} "${table.name}"? This will remove the ${label}.`,
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
      const saved = localStorage.getItem(postgresDatabaseVisibilityStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          all?: unknown;
          databases?: unknown;
        };
        showAll = parsed.all !== false;
        databases = Array.isArray(parsed.databases)
          ? parsed.databases.filter(
              (database): database is string => typeof database === "string",
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
      connectionId: canBrowseDatabaseCatalogs ? activeConnectionId : null,
      schemas: {},
      tables: {},
      objects: {},
    });
  }, [
    activeConnectionId,
    activeDriver,
    canBrowseDatabaseCatalogs,
    postgresDatabaseRefreshVersion,
  ]);

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
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return () => {
        cancelled = true;
      };
    }
    setConnectionCapabilities(null);

    databaseService
      .getDatabaseCapabilities(
        activeDriver,
        activeConnection?.driverPackageVersion,
      )
      .then((nextCapabilities) => {
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: nextCapabilities,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: fallback,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeConnection?.driverPackageVersion,
    activeConnection?.id,
    activeDriver,
    driverCatalogStatus,
  ]);

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
            shouldLimitVisibleSchemas ? parsed.all === true : true,
          );
          setVisibleSchemaNames(
            Array.isArray(parsed.schemas)
              ? parsed.schemas.filter(
                  (schema): schema is string => typeof schema === "string",
                )
              : [],
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
            }),
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
    // Descriptor objects are supplementary metadata. Built-in drivers that do
    // not expose them and older external sidecars both return an empty list,
    // while a newly capable package (for example Xugu types) can appear here
    // without adding another driver-name branch to the Explorer.
    const supportsDescriptors = activeCapabilities.dataModel === "relational";
    if (
      !shouldAutoIntrospect ||
      !isActiveConnectionReady ||
      !activeConnectionId ||
      !currentSchema ||
      !isActiveNamespaceExpanded ||
      !supportsDescriptors
    ) {
      setSchemaObjectDescriptors([]);
      setSchemaObjectDescriptorScope(null);
      setIsSchemaObjectDescriptorsLoading(false);
      return;
    }
    let cancelled = false;
    setIsSchemaObjectDescriptorsLoading(true);
    void schemaService
      .getSchemaObjects(activeConnectionId, currentSchema)
      .then((objects) => {
        if (!cancelled) {
          setSchemaObjectDescriptors(objects);
          setSchemaObjectDescriptorScope(
            `${activeConnectionId}:${currentSchema}`,
          );
        }
      })
      .catch(() => {
        // Object descriptors are supplementary metadata. A failure must not
        // hide relation metadata or promote an unsupported product to an
        // erroring Explorer state.
        if (!cancelled) {
          setSchemaObjectDescriptors([]);
          setSchemaObjectDescriptorScope(null);
        }
      })
      .finally(() => {
        if (!cancelled) setIsSchemaObjectDescriptorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConnectionId,
    activeDriver,
    currentSchema,
    isActiveConnectionReady,
    isActiveNamespaceExpanded,
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
      // Show the cached collection snapshot immediately, then refresh it in
      // the background so a previously empty MongoDB cache cannot become
      // permanently stale until the user clicks Refresh.
      void loadCollections(
        activeConnectionId,
        collectionNamespace,
        false,
        "",
        true,
      );
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
        filterText,
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
    schema: string,
  ) => {
    const isActiveSchema =
      connectionId === activeConnectionId && schema === currentSchema;
    const snapshot = isActiveSchema
      ? null
      : objectSnapshots[
          getSchemaObjectMetadataSnapshotKey(connectionId, driver, schema)
        ];
    const schemaTables = canBrowseTables
      ? (snapshot?.tables ?? (isActiveSchema ? tables : []))
      : [];
    const schemaCollections = canBrowseCollections
      ? (snapshot?.collections ?? (isActiveSchema ? collections : []))
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
        table.name.toLowerCase().includes(filterText.toLowerCase()),
      ),
      collections: [...schemaCollections]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((collection) => {
          const normalizedFilter = filterText.toLowerCase();
          return (
            collection.name.toLowerCase().includes(normalizedFilter) ||
            collectionDisplayLabelForCapabilities(
              activeCapabilities,
              collection,
            )
              .toLowerCase()
              .includes(normalizedFilter)
          );
        }),
      functions: schemaFunctions.filter((routine) =>
        routineMatchesFilter(routine, filterText),
      ),
      pinnedTables: schemaPinnedTables,
      hasSnapshot: Boolean(snapshot),
    };
  };

  const postgresDatabaseMatchesFilter = (
    connectionId: string,
    database: string,
    currentDatabase: string,
    normalizedFilter: string,
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
                schema,
              )
            ];
        const schemaTables = isActiveSchema ? tables : snapshot?.tables || [];
        const schemaFunctions = isActiveSchema
          ? functions
          : snapshot?.functions || [];
        return (
          schemaTables.some((table) =>
            table.name.toLocaleLowerCase().includes(normalizedFilter),
          ) ||
          schemaFunctions.some((routine) =>
            routineMatchesFilter(routine, normalizedFilter),
          )
        );
      });
    }

    if (postgresRemoteDatabases.connectionId !== connectionId) return false;
    return (
      (postgresRemoteDatabases.schemas[database] || []).some((schema) =>
        schema.toLocaleLowerCase().includes(normalizedFilter),
      ) ||
      Object.values(postgresRemoteDatabases.tables[database] || {}).some(
        (databaseTables) =>
          databaseTables.some((table) =>
            table.name.toLocaleLowerCase().includes(normalizedFilter),
          ),
      ) ||
      Object.values(postgresRemoteDatabases.objects[database] || {}).some(
        (databaseObjects) =>
          databaseObjects.some((object) =>
            `${object.name} ${object.objectType} ${object.parentName || ""}`
              .toLocaleLowerCase()
              .includes(normalizedFilter),
          ),
      )
    );
  };

  const findOrCreateTableTab = useTabStore(
    (state) => state.findOrCreateTableTab,
  );
  const findOrCreateObjectDataTab = useTabStore(
    (state) => state.findOrCreateObjectDataTab,
  );
  const loadTablePage = useTabStore((state) => state.loadTablePage);
  const loadDocumentPage = useTabStore((state) => state.loadDocumentPage);
  const createTableTab = useTabStore((state) => state.createTableTab);
  const openDatabaseBrowser = useTabStore((state) => state.openDatabaseBrowser);
  const openRocketMqWorkspace = useTabStore(
    (state) => state.openRocketMqWorkspace,
  );
  const createTab = useTabStore((state) => state.createTab);
  const openSchemaDiagramTab = useTabStore(
    (state) => state.openSchemaDiagramTab,
  );
  const runTabQuery = useTabStore((state) => state.runTabQuery);
  const setTableMetadata = useTabStore((state) => state.setTableMetadata);

  const handleNewQueryConsole = () => {
    const queryNumber =
      useTabStore.getState().tabs.filter((tab) => tab.type === "query").length +
      1;
    const connectionName = activeConnection?.name;
    createTab(
      "query",
      connectionName ? `console [${connectionName}]` : `Query #${queryNumber}`,
      "",
      {
        connectionId: activeConnectionId || undefined,
        schemaName: currentSchema || undefined,
      },
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

  const handleOpenDataTransfer = async (options: {
    connection: (typeof connections)[number];
    database?: string;
    schema?: string;
    table?: string;
    tables?: string[];
    scope: "table" | "schema" | "database";
  }) => {
    const {
      connection,
      database,
      scope,
      table,
      tables: requestedTables,
    } = options;
    setNamespaceError(null);
    try {
      const connectionError = await setActiveConnection(connection.id);
      if (connectionError) throw new Error(connectionError);

      const capabilityContext =
        await databaseService.getConnectionDatabaseCapabilityContext(
          connection.id,
        );
      if (!capabilityContext.capabilities.supportsTableDataTransfer) {
        throw new Error(
          `${capabilityContext.capabilities.displayName} does not expose a verified table-data transfer contract.`,
        );
      }

      const schemas = options.schema
        ? [options.schema]
        : database
          ? await schemaService.getDatabaseSchemas(connection.id, database)
          : await schemaService.getSchemas(connection.id);
      const schema =
        options.schema ||
        [currentSchema, "public", "dbo", schemas[0]].find(
          (candidate): candidate is string =>
            Boolean(candidate && schemas.includes(candidate)),
        );
      if (!schema) {
        throw new Error("No transferable schema was found in this database.");
      }

      let sourceTable = table || requestedTables?.[0];
      if (!sourceTable) {
        const relations = database
          ? await schemaService.getDatabaseTables(
              connection.id,
              database,
              schema,
            )
          : await schemaService.getTables(connection.id, schema);
        sourceTable = relations
          .filter((relation) => !relation.type?.toUpperCase().includes("VIEW"))
          .map((relation) => relation.name)
          .sort((left, right) => left.localeCompare(right))[0];
      }
      if (!sourceTable) {
        throw new Error(
          `No transferable tables were found in ${[database, schema].filter(Boolean).join(".")}.`,
        );
      }

      setDataTransferRequest({
        source: {
          connectionId: connection.id,
          driver: connection.driver,
          database,
          schema,
          table: sourceTable,
        },
        sourceCapabilities: capabilityContext.capabilities,
        initialSourceScope: scope,
        sourceSchemas: schemas,
        initialSourceTables: requestedTables,
      });
    } catch (error) {
      setNamespaceError(
        `Could not prepare data transfer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleOpenSchemaDiagram = async (
    identity: SchemaSnapshotIdentity,
    selectedRelations: readonly string[] = [],
  ) => {
    const loadingKey = [
      identity.connectionId,
      identity.databaseName || "",
      identity.schemaName,
    ].join("\u0000");
    if (schemaDiagramLoadingKey) return;
    setSchemaDiagramLoadingKey(loadingKey);
    setNamespaceError(null);
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "introspection",
      title: `Diagram ${identity.schemaName}`,
      detail: identity.databaseName || identity.connectionName,
    });
    try {
      const connectionError = await setActiveConnection(identity.connectionId);
      if (connectionError) throw new Error(connectionError);
      const snapshot = await captureLiveSchemaSnapshot(identity, {
        allowPartial: true,
      });
      const tabId = openSchemaDiagramTab(snapshot);
      if (selectedRelations.length > 0) {
        const availableRelations = new Set(
          snapshot.relations.map((relation) => relation.name),
        );
        useTabStore.getState().selectSchemaDiagramRelations(
          tabId,
          selectedRelations.filter((name) => availableRelations.has(name)),
        );
      }
      tasks.finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} relations mapped`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tasks.failTask(taskId, message);
      setNamespaceError(`Diagram capture failed: ${message}`);
    } finally {
      setSchemaDiagramLoadingKey(null);
    }
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
        ids.filter((id) => id !== connectionId),
      );
      setExpandedSchemaKeys((keys) =>
        keys.filter((key) => !key.startsWith(`${connectionId}:`)),
      );
      setExpandedObjectGroupKeys((keys) =>
        keys.filter((key) => !key.startsWith(`${connectionId}:`)),
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
        : [...current, activeConnectionId],
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
    schemaName = currentSchema || "",
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
      table.type,
      undefined,
      { reuseMode: tableTabReuseMode },
    );

    await loadTablePage(tabId, 0);
  };

  const handleTableCsvImport = async (table: TableInfo, schemaName: string) => {
    if (!activeConnectionId) return;
    await handleTableDoubleClick(table, schemaName);
    const detail: TableCsvImportRequest = {
      connectionId: activeConnectionId,
      schema: schemaName,
      table: table.name,
    };
    // Opening a table updates the active tab asynchronously. Waiting until the
    // next frame ensures the receiving table workspace has rebound to the
    // selected relation before it opens its shared mapping dialog.
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<TableCsvImportRequest>(
          APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
          { detail },
        ),
      );
    });
  };

  const handleTableJsonImport = async (
    table: TableInfo,
    schemaName: string,
  ) => {
    if (!activeConnectionId) return;
    await handleTableDoubleClick(table, schemaName);
    const detail: TableJsonImportRequest = {
      connectionId: activeConnectionId,
      schema: schemaName,
      table: table.name,
    };
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<TableJsonImportRequest>(
          APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
          { detail },
        ),
      );
    });
  };

  const handleTableXlsxImport = async (
    table: TableInfo,
    schemaName: string,
  ) => {
    if (!activeConnectionId) return;
    await handleTableDoubleClick(table, schemaName);
    const detail: TableXlsxImportRequest = {
      connectionId: activeConnectionId,
      schema: schemaName,
      table: table.name,
    };
    window.requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent<TableXlsxImportRequest>(
          APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
          { detail },
        ),
      );
    });
  };

  const handlePostgresRemoteTableOpen = async (
    connectionId: string,
    databaseName: string,
    schemaName: string,
    table: TableInfo,
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
      databaseName,
      { reuseMode: tableTabReuseMode },
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
      collection,
    );

  const collectionDeleteSql = (collection: CollectionInfo) =>
    collectionDeleteQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      collection,
    );

  const collectionCreateSql = (name: string) =>
    collectionCreateQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      name,
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

    const previewCommand = collectionPreviewSql(collection);
    const tabId = findOrCreateObjectDataTab(
      activeConnectionId,
      collectionNamespace,
      collection.name,
      collection.type,
      previewCommand,
      collectionPreviewTabTitleForCapabilities(
        activeCapabilities,
        collection,
        collectionNamespaceForTemplate,
      ),
    );
    if (activeCapabilities.dataModel === "search") {
      void loadDocumentPage(tabId, 0);
    } else {
      void runTabQuery(tabId, activeConnectionId, previewCommand);
    }
  };

  const handleOpenDataCompare = async (options: {
    connection: (typeof connections)[number];
    database?: string;
    schema?: string;
    table?: string;
    tables?: string[];
  }) => {
    setNamespaceError(null);
    try {
      const readiness = await setActiveConnection(options.connection.id);
      if (readiness) throw new Error(readiness);
      const context =
        await databaseService.getConnectionDatabaseCapabilityContext(
          options.connection.id,
        );
      if (!supportsTableWorkspace(context.capabilities)) {
        throw new Error(
          `${context.capabilities.displayName} does not expose a comparable table workspace.`,
        );
      }
      const availableSchemas = options.database
        ? await schemaService.getDatabaseSchemas(
            options.connection.id,
            options.database,
          )
        : await schemaService.getSchemas(options.connection.id);
      const schema =
        options.schema ||
        [currentSchema, "public", "dbo", availableSchemas[0]].find(
          (candidate): candidate is string =>
            Boolean(candidate && availableSchemas.includes(candidate)),
        );
      if (!schema) throw new Error("No comparable schema was found.");
      const requested = options.tables?.length
        ? options.tables
        : options.table
          ? [options.table]
          : [];
      const tableNames = requested.length
        ? requested
        : (options.database
            ? await schemaService.getDatabaseTables(
                options.connection.id,
                options.database,
                schema,
              )
            : await schemaService.getTables(options.connection.id, schema)
          )
            .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
            .map((item) => item.name);
      const sourceTables = [...new Set(tableNames)].sort((left, right) =>
        left.localeCompare(right),
      );
      if (sourceTables.length === 0) {
        throw new Error(`No comparable tables were found in ${schema}.`);
      }
      setDataCompareRequest({
        source: {
          connectionId: options.connection.id,
          driver: options.connection.driver,
          database: options.database,
          schema,
          table: sourceTables[0]!,
        },
        sourceTables,
        sourceCapabilities: context.capabilities,
      });
    } catch (nextError) {
      setNamespaceError(
        `Could not prepare data comparison: ${nextError instanceof Error ? nextError.message : String(nextError)}`,
      );
    }
  };

  const refreshSelectedTableMetadata = async (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    driverPackageVersion?: string | null;
    connectionDatabaseName?: string | null;
    databaseName?: string;
    schema: string;
    tables: string[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    setTableBatchAction({
      scopeKey: options.scopeKey,
      running: true,
      message: `Refreshing ${options.tables.length} table${options.tables.length === 1 ? "" : "s"}…`,
    });
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "introspection",
      title: `Refresh ${options.tables.length} table${options.tables.length === 1 ? "" : "s"}`,
      detail: options.schema,
    });
    try {
      const readinessError = await setActiveConnection(options.connectionId);
      if (readinessError) throw new Error(readinessError);
      const results = await settleTableBatchWork(
        options.tables,
        (table) =>
          loadTableMetadata({
            projectId: activeProjectId || undefined,
            connectionId: options.connectionId,
            driver: options.driver,
            driverPackageVersion: options.driverPackageVersion,
            connectionDatabaseName: options.connectionDatabaseName,
            databaseName: options.databaseName,
            schema: options.schema,
            table,
            includeIndexes: true,
            includeConstraints: true,
            force: true,
            priority: "interactive",
          }),
        6,
      );
      const failureSummary = summarizeTableBatchFailures(
        options.tables,
        results,
      );
      const refreshed = results.length - failureSummary.total;
      bumpMetadataVersion();
      await settleTableBatchWork(
        options.tables,
        (table) =>
          useTabStore
            .getState()
            .refreshTableTabs(
              options.connectionId,
              options.schema,
              table,
              false,
            ),
        6,
      );
      const message = failureSummary.total
        ? `${refreshed} refreshed · ${failureSummary.total} failed`
        : `${refreshed} refreshed`;
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message,
        failures: failureSummary.failures,
        omittedFailures: failureSummary.omitted,
      });
      if (failureSummary.total) {
        tasks.failTask(
          taskId,
          `${failureSummary.total} table metadata refresh${failureSummary.total === 1 ? "" : "es"} failed`,
          message,
        );
      } else {
        tasks.finishTask(taskId, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `Refresh failed: ${message}`,
      });
      tasks.failTask(taskId, message);
    }
  };

  const exportSelectedTablesSql = async (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    schema: string;
    tables: string[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    const exportId = tableService.createTableExportId();
    const tasks = useTaskStore.getState();
    const taskId = tasks.startTask({
      kind: "export",
      title: `Export ${options.tables.length} table${options.tables.length === 1 ? "" : "s"} to SQL`,
      detail: options.schema,
    });
    setTableBatchAction({
      scopeKey: options.scopeKey,
      running: true,
      message: "Preparing SQL export…",
      cancelId: exportId,
    });
    let unlisten: (() => void) | undefined;
    try {
      const readinessError = await setActiveConnection(options.connectionId);
      if (readinessError) throw new Error(readinessError);
      unlisten = await tableService.listenTableExportProgress((progress) => {
        if (progress.exportId !== exportId || progress.terminal) return;
        const detail = `${progress.rowsExported.toLocaleString()} rows · ${progress.batches.toLocaleString()} batches`;
        tasks.updateTask(taskId, { detail });
        setTableBatchAction((current) =>
          current?.cancelId === exportId
            ? { ...current, message: detail }
            : current,
        );
      });
      const result = await tableService.exportDatabaseSql(
        options.connectionId,
        options.driver,
        options.schema,
        {
          exportId,
          includeStructure: false,
          includeData: true,
          tableNames: [...options.tables],
        },
      );
      const message = `${result.tablesExported.toLocaleString()} tables · ${result.rowsExported.toLocaleString()} rows`;
      tasks.finishTask(taskId, `${message} · ${result.filePath}`);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `${message} exported`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) {
        tasks.cancelTask(taskId, "Export cancelled; partial file removed");
        setTableBatchAction({
          scopeKey: options.scopeKey,
          running: false,
          message: "Export cancelled",
        });
      } else {
        tasks.failTask(taskId, message);
        setTableBatchAction({
          scopeKey: options.scopeKey,
          running: false,
          message: `Export failed: ${message}`,
        });
      }
    } finally {
      unlisten?.();
    }
  };

  const cancelSelectedTableExport = async () => {
    const exportId = tableBatchAction?.cancelId;
    if (!exportId || !tableBatchAction.running) return;
    setTableBatchAction((current) =>
      current?.cancelId === exportId
        ? { ...current, message: "Cancellation requested…" }
        : current,
    );
    await tableService.cancelTableExport(exportId);
  };

  const copySelectedTableNames = async (options: {
    scopeKey: string;
    tables: string[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    try {
      await copyText(formatTableBatchNamesForClipboard(options.tables));
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `${options.tables.length} name${options.tables.length === 1 ? "" : "s"} copied`,
      });
    } catch {
      // copyText owns the user-visible clipboard failure message.
    }
  };

  const showSelectedTableDdl = async (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    driverPackageVersion?: string | null;
    connectionDatabaseName?: string | null;
    databaseName?: string;
    schema: string;
    tables: TableInfo[];
  }) => {
    if (options.tables.length === 0 || tableBatchAction?.running) return;
    setTableBatchAction({
      scopeKey: options.scopeKey,
      running: true,
      message: `Loading DDL for ${options.tables.length} table${options.tables.length === 1 ? "" : "s"}…`,
    });
    try {
      const readinessError = await setActiveConnection(options.connectionId);
      if (readinessError) throw new Error(readinessError);
      const tableNames = options.tables.map((table) => table.name);
      const tableTypes = new Map(
        options.tables.map((table) => [table.name, table.type] as const),
      );
      const results = await settleTableBatchWork(
        tableNames,
        (table) =>
          loadTableDdl(
            {
              projectId: activeProjectId || undefined,
              connectionId: options.connectionId,
              driver: options.driver,
              driverPackageVersion: options.driverPackageVersion,
              connectionDatabaseName: options.connectionDatabaseName,
              databaseName: options.databaseName,
              schema: options.schema,
              table,
            },
            tableTypes.get(table),
          ),
        6,
      );
      const failureSummary = summarizeTableBatchFailures(tableNames, results);
      const ddl = composeTableBatchDdl(options.schema, tableNames, results);
      const loadedCount = results.filter(
        (result) => result.status === "fulfilled" && result.value.trim(),
      ).length;
      if (!ddl) {
        throw new Error("No table DDL could be loaded.");
      }
      setActiveTable(
        `${options.tables.length} selected table${options.tables.length === 1 ? "" : "s"}`,
      );
      setActiveTableType(null);
      setDdlContent(ddl);
      setDdlViewerOpen(true);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: failureSummary.total
          ? `${loadedCount} DDL loaded · ${failureSummary.total} failed`
          : `${loadedCount} DDL loaded`,
        failures: failureSummary.failures,
        omittedFailures: failureSummary.omitted,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTableBatchAction({
        scopeKey: options.scopeKey,
        running: false,
        message: `DDL failed: ${message}`,
      });
    }
  };

  const handleCopyCollectionPreview = async (collection: CollectionInfo) => {
    try {
      await navigator.clipboard.writeText(collectionPreviewSql(collection));
    } catch (err: any) {
      window.alert(`Failed to copy preview request: ${err?.message || err}`);
    }
  };

  const handleElasticsearchIndexCleared = async (
    _result: SearchIndexClearResult,
    clearedIndex: string,
  ) => {
    const target = elasticsearchClearTarget;
    if (!target) return;
    await loadCollections(target.connectionId, target.schema, true);
    bumpMetadataVersion();
    const tabs = useTabStore
      .getState()
      .tabs.filter(
        (tab) =>
          tab.connectionId === target.connectionId &&
          Boolean(tab.tableName) &&
          searchIndexClearTouched(clearedIndex, tab.tableName || ""),
      );
    await Promise.allSettled(tabs.map((tab) => loadDocumentPage(tab.id, 0)));
  };

  const handleDeleteCollectionClick = (collection: CollectionInfo) => {
    if (!activeConnectionId) return;

    const sql = collectionDeleteSql(collection);
    if (!sql) {
      window.alert(
        `${activeCapabilities.displayName} ${collectionLabel.toLowerCase()} deletion is not supported.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete ${collectionLabel.toLowerCase()} "${collection.name}"? This cannot be undone.`,
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

    if (
      activeCapabilities.dataModel === "keyValue" &&
      activeConnection?.driver === "redis"
    ) {
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
        `${activeCapabilities.displayName} ${collectionLabel.toLowerCase()} creation is not supported.`,
      );
      return;
    }

    const tabId = createTab(
      "query",
      `Create ${collectionLabel}: ${name}`,
      sql,
      {
        connectionId: activeConnectionId,
        schemaName: collectionNamespace || undefined,
        tableName: name,
        objectType: collectionLabel.toLowerCase(),
      },
    );
    void runCollectionMutation(tabId, sql);
  };

  const handleCreateRedisKey = async (name: string, command: string) => {
    if (!activeConnectionId) throw new Error("No active Redis connection.");
    const normalizedName = name.trim();
    const existing = await queryService.executeQuery(
      activeConnectionId,
      `EXISTS ${JSON.stringify(normalizedName)}`,
      collectionNamespace || undefined,
    );
    if (Number(existing[0]?.rows?.[0]?.[1] ?? 0) > 0) {
      throw new Error(`Key "${normalizedName}" already exists.`);
    }
    await queryService.executeQuery(
      activeConnectionId,
      command,
      collectionNamespace || undefined,
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

  const handleCreateTable = () => {
    if (
      activeConnectionId &&
      currentSchema &&
      canBrowseTables &&
      activeCapabilities.supportsTableDdl
    ) {
      createTableTab(activeConnectionId, currentSchema);
    }
  };

  const handleCreateView = () => {
    if (
      activeConnectionId &&
      currentSchema &&
      activeCapabilities.supportsViews
    ) {
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
        `${activeCapabilities.displayName} ${namespaceLabel} creation is not supported.`,
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
        `${activeCapabilities.displayName} ${namespaceLabel} rename is not supported safely.`,
      );
      return;
    }

    const nextName = window.prompt(
      `Rename ${namespaceLabel} to:`,
      targetSchema,
    );
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === targetSchema) return;

    setNamespaceError(null);
    try {
      await databaseService.renameDatabase(
        activeConnectionId,
        activeDriver,
        targetSchema,
        trimmedName,
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
        `${activeCapabilities.displayName} ${namespaceLabel} deletion is not supported.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Drop ${namespaceLabel} "${targetSchema}" and all contained objects? This cannot be undone.`,
    );
    if (!confirmed) return;

    setNamespaceError(null);
    try {
      await databaseService.dropDatabase(
        activeConnectionId,
        activeDriver,
        targetSchema,
        true,
      );
      await loadSchemas(activeConnectionId, true);
      bumpMetadataVersion();
    } catch (err: any) {
      setNamespaceError(err?.message || String(err));
    }
  };

  const handleRefresh = async () => {
    if (activeConnectionId) {
      if (canBrowseDatabaseCatalogs) {
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
          activeCapabilities.dataModel === "keyValue" ? filterText : undefined,
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
    if (
      wasActiveConnection &&
      supportsDatabaseCatalogTree(connection?.driver)
    ) {
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
        activeCapabilities.dataModel === "keyValue" ? filterText : undefined,
      );
    }
  };

  const queuePostgresRemoteRefresh = (
    connectionId: string,
    database: string,
    schema?: string,
  ) => {
    postgresRemoteRefreshVersionRef.current += 1;
    setPostgresRemoteRefreshRequest({
      connectionId,
      database,
      version: postgresRemoteRefreshVersionRef.current,
      ...(schema ? { schema } : {}),
    });
  };

  const refreshPostgresRemoteDatabase = async (
    connectionId: string,
    database: string,
    schema?: string,
  ) => {
    try {
      await loadPostgresRemoteDatabase(connectionId, database);
      queuePostgresRemoteRefresh(connectionId, database, schema);
      setNamespaceError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNamespaceError(`Could not refresh database "${database}": ${message}`);
    }
  };

  const requestExplorerTargetRefresh = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;

    const objectRow = target.closest<HTMLElement>("[data-database-object-key]");
    const objectTarget = objectRow?.dataset.databaseObjectKey
      ? parseDatabaseObjectNavigationKey(objectRow.dataset.databaseObjectKey)
      : null;
    if (objectTarget?.schemaName) {
      const connection = connections.find(
        (item) => item.id === objectTarget.connectionId,
      );
      if (!connection) return false;
      const capabilities = defaultDatabaseCapabilities(connection.driver);
      if (supportsTableWorkspace(capabilities)) {
        void refreshSelectedTableMetadata({
          scopeKey: objectGroupKey(
            connection.id,
            connection.driver,
            objectTarget.schemaName,
            "objects",
          ),
          connectionId: connection.id,
          driver: connection.driver,
          driverPackageVersion: connection.driverPackageVersion,
          connectionDatabaseName: connection.database,
          databaseName: objectTarget.databaseName,
          schema: objectTarget.schemaName,
          tables: [objectTarget.objectName],
        });
      } else {
        void handleRefreshSchema(connection.id, objectTarget.schemaName);
      }
      return true;
    }

    const schemaRow = target.closest<HTMLElement>("[data-database-schema-key]");
    const schemaTarget = schemaRow?.dataset.databaseSchemaKey
      ? parseDatabaseSchemaNavigationKey(schemaRow.dataset.databaseSchemaKey)
      : null;
    if (schemaTarget?.schemaName) {
      const connection = connections.find(
        (item) => item.id === schemaTarget.connectionId,
      );
      if (!connection) return false;
      const connectedDatabase = supportsDatabaseCatalogTree(connection.driver)
        ? connectionCatalogDatabaseName(connection)
        : connection.database || "";
      if (
        schemaTarget.databaseName &&
        schemaTarget.databaseName !== connectedDatabase
      ) {
        void refreshPostgresRemoteDatabase(
          connection.id,
          schemaTarget.databaseName,
          schemaTarget.schemaName,
        );
      } else {
        void handleRefreshSchema(connection.id, schemaTarget.schemaName);
      }
      return true;
    }

    const databaseRow = target.closest<HTMLElement>("[data-postgres-database]");
    const connectionRegion = target.closest<HTMLElement>(
      "[data-database-connection-id]",
    );
    const connectionId = connectionRegion?.dataset.databaseConnectionId;
    const database = databaseRow?.dataset.postgresDatabase;
    if (connectionId && database) {
      const connection = connections.find((item) => item.id === connectionId);
      if (!connection) return false;
      const connectedDatabase = connectionCatalogDatabaseName(connection);
      if (database === connectedDatabase) {
        void handleRefreshConnection(connectionId);
      } else {
        void refreshPostgresRemoteDatabase(connectionId, database);
      }
      return true;
    }

    if (connectionId) {
      void handleRefreshConnection(connectionId);
      return true;
    }
    return false;
  };

  const handleExplorerKeyDownCapture = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (
      !isExplorerRefreshShortcut(event.nativeEvent) ||
      isEditableExplorerShortcutTarget(event.target) ||
      !requestExplorerTargetRefresh(event.target)
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const handleForgetConnectionMetadata = async (
    connectionId: string,
    connectionName: string,
  ) => {
    const confirmed = window.confirm(
      `Forget cached metadata for "${connectionName}"? The next refresh will introspect the data source again.`,
    );
    if (!confirmed) return;

    await forgetConnectionMetadata(connectionId);
    setExpandedSchemaKeys((current) =>
      current.filter((key) => !key.startsWith(`${connectionId}:`)),
    );
    setExpandedObjectGroupKeys((current) =>
      current.filter((key) => !key.startsWith(`${connectionId}:`)),
    );
  };

  const handleForgetSchemaMetadata = async (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
  ) => {
    const confirmed = window.confirm(
      `Forget cached object metadata for "${schema}"? The schema will stay listed, but tables and routines will be loaded again on refresh.`,
    );
    if (!confirmed) return;

    await forgetSchemaMetadata(connectionId, schema);
    const groupPrefix = objectGroupKey(connectionId, driver, schema, "");
    setExpandedObjectGroupKeys((current) =>
      current.filter((key) => !key.startsWith(groupPrefix)),
    );
  };

  const handleSchemaSelect = async (schema: string) => {
    await setCurrentSchema(schema);
    setFilterText("");
  };

  const runForSchema = async (
    schema: string,
    action: () => void | Promise<void>,
  ) => {
    if (schema !== currentSchema) {
      await handleSchemaSelect(schema);
    }
    await action();
  };

  const handleImportSqlScript = ({
    connectionId,
    schema,
    database,
  }: {
    connectionId: string;
    schema?: string;
    database?: string;
  }) => {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) {
      setNamespaceError("The selected data source is no longer available.");
      return;
    }
    if (!defaultDatabaseCapabilities(connection.driver).supportsSqlQuery) {
      setNamespaceError(
        `${databaseDriverProfile(connection.driver).capabilities.displayName} does not accept SQL scripts.`,
      );
      return;
    }

    const target = [database, schema].filter(Boolean).join(".");
    setNamespaceError(null);
    void requestSqlScriptImport({
      connectionId,
      schema,
      database,
      label: target || connection.name,
      driver: connection.driver,
    });
  };

  const handleConnectionRowClick = async (connectionId: string) => {
    const isExpanded = expandedConnectionIds.includes(connectionId);
    const isConnected = connectedConnectionIds.includes(connectionId);

    if (isExpanded && isConnected) {
      setExpandedConnectionIds((current) =>
        current.filter((id) => id !== connectionId),
      );
      return;
    }

    // Expand immediately so SQLite metadata can paint while the remote
    // connection is still being established. Keep only the selected source
    // expanded because object capabilities are scoped to the active driver.
    setExpandedConnectionIds([connectionId]);
    if (!isConnected) {
      setConnectingConnectionIds((current) =>
        current.includes(connectionId) ? current : [...current, connectionId],
      );
    }
    try {
      await setActiveConnection(connectionId);
    } finally {
      setConnectingConnectionIds((current) =>
        current.filter((id) => id !== connectionId),
      );
    }
  };

  const loadPostgresRemoteDatabase = async (
    connectionId: string,
    database: string,
  ) => {
    const requestKey = `${connectionId}:${database}`;
    const requestId = postgresRemoteRequestCounter.current + 1;
    postgresRemoteRequestCounter.current = requestId;
    const contextVersion = postgresRemoteContextVersion.current;
    postgresRemoteRequestIds.current[requestKey] = requestId;
    const databaseSchemas = await schemaService.getDatabaseSchemas(
      connectionId,
      database,
    );

    const connectionState = useConnectionStore.getState();
    const connection = connectionState.connections.find(
      (item) => item.id === connectionId,
    );
    if (
      postgresRemoteRequestIds.current[requestKey] !== requestId ||
      postgresRemoteContextVersion.current !== contextVersion ||
      connectionState.activeConnectionId !== connectionId ||
      !connectionState.connectedConnectionIds.includes(connectionId) ||
      !supportsDatabaseCatalogTree(connection?.driver)
    ) {
      return;
    }

    setPostgresRemoteDatabases((current) => ({
      connectionId,
      schemas: {
        ...(current.connectionId === connectionId ? current.schemas : {}),
        [database]: Array.from(new Set(databaseSchemas)),
      },
      tables: current.connectionId === connectionId ? current.tables : {},
      objects: current.connectionId === connectionId ? current.objects : {},
    }));
  };

  const handlePostgresRemoteTablesLoaded = (
    connectionId: string,
    database: string,
    schema: string,
    databaseTables: TableInfo[],
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

  // DBX searches collapsed catalog containers too. Keep Oxide's equivalent
  // bounded and cancellation-safe: wait briefly for typing to settle, load
  // only metadata that is absent from the local cache, and discard results
  // once the filter, connection, or catalog context changes.
  useEffect(() => {
    const normalizedFilter = filterText.trim().toLocaleLowerCase();
    const generation = postgresGlobalSearchGenerationRef.current + 1;
    postgresGlobalSearchGenerationRef.current = generation;
    if (
      !normalizedFilter ||
      !activeConnectionId ||
      !canBrowseDatabaseCatalogs ||
      !isActiveConnectionReady
    ) {
      return;
    }

    const connectionId = activeConnectionId;
    const contextVersion = postgresRemoteContextVersion.current;
    const databases = visiblePostgresDatabases.filter(
      (database) => database !== activePostgresDatabase,
    );
    const cachedRemote =
      postgresRemoteDatabases.connectionId === connectionId
        ? postgresRemoteDatabases
        : { connectionId, schemas: {}, tables: {}, objects: {} };
    const timeout = window.setTimeout(() => {
      void (async () => {
        const schemaResults = await runSidebarSearchTasks(
          collapsedDatabaseSchemaTargets(
            databases,
            activePostgresDatabase,
            cachedRemote,
          )
            .map((database) => async () => ({
              database,
              schemas: await schemaService.getDatabaseSchemas(
                connectionId,
                database,
              ),
            })),
        );
        if (
          postgresGlobalSearchGenerationRef.current !== generation ||
          postgresRemoteContextVersion.current !== contextVersion ||
          useConnectionStore.getState().activeConnectionId !== connectionId
        ) {
          return;
        }

        const discoveredSchemas = new Map<string, string[]>();
        for (const result of schemaResults) {
          if (result?.status === "fulfilled") {
            discoveredSchemas.set(
              result.value.database,
              Array.from(new Set(result.value.schemas)),
            );
          }
        }
        const schemaByDatabase = new Map<string, string[]>();
        for (const database of databases) {
          schemaByDatabase.set(
            database,
            discoveredSchemas.get(database) || cachedRemote.schemas[database] || [],
          );
        }
        if (discoveredSchemas.size > 0) {
          setPostgresRemoteDatabases((current) => {
            if (current.connectionId !== connectionId) return current;
            return {
              ...current,
              schemas: {
                ...current.schemas,
                ...Object.fromEntries(discoveredSchemas),
              },
            };
          });
        }

        const metadataResults = await runSidebarSearchTasks(
          collapsedSchemaMetadataTargets(schemaByDatabase, cachedRemote).map(
            ({ database, schema }) => async () => {
                const objectRequest =
                  typeof schemaService.getDatabaseSchemaObjects === "function"
                    ? schemaService
                        .getDatabaseSchemaObjects(connectionId, database, schema)
                        .catch(() => [] as SchemaObjectInfo[])
                    : Promise.resolve([] as SchemaObjectInfo[]);
                const [tables, objects] = await Promise.all([
                  schemaService.getDatabaseTables(connectionId, database, schema),
                  objectRequest,
                ]);
                return { database, schema, tables, objects };
            },
          ),
        );
        if (
          postgresGlobalSearchGenerationRef.current !== generation ||
          postgresRemoteContextVersion.current !== contextVersion ||
          useConnectionStore.getState().activeConnectionId !== connectionId
        ) {
          return;
        }
        const tablePatches: Record<string, Record<string, TableInfo[]>> = {};
        const objectPatches: Record<
          string,
          Record<string, SchemaObjectInfo[]>
        > = {};
        for (const result of metadataResults) {
          if (result?.status !== "fulfilled") continue;
          const { database, schema, tables, objects } = result.value;
          tablePatches[database] = {
            ...(tablePatches[database] || {}),
            [schema]: tables,
          };
          objectPatches[database] = {
            ...(objectPatches[database] || {}),
            [schema]: objects,
          };
        }
        if (Object.keys(tablePatches).length === 0) return;
        setPostgresRemoteDatabases((current) => {
          if (current.connectionId !== connectionId) return current;
          return {
            ...current,
            tables: {
              ...current.tables,
              ...Object.fromEntries(
                Object.entries(tablePatches).map(([database, tables]) => [
                  database,
                  { ...(current.tables[database] || {}), ...tables },
                ]),
              ),
            },
            objects: {
              ...current.objects,
              ...Object.fromEntries(
                Object.entries(objectPatches).map(([database, objects]) => [
                  database,
                  { ...(current.objects[database] || {}), ...objects },
                ]),
              ),
            },
          };
        });
      })();
    }, 180);

    return () => window.clearTimeout(timeout);
  }, [
    activeConnectionId,
    activePostgresDatabase,
    canBrowseDatabaseCatalogs,
    filterText,
    isActiveConnectionReady,
    postgresRemoteDatabases,
    visiblePostgresDatabases,
  ]);

  const handleSchemaRowClick = async (
    connectionId: string,
    schema: string,
    isCurrentSchema: boolean,
  ) => {
    const connection = connections.find((item) => item.id === connectionId);
    const driver = connection?.driver || activeDriver;
    const isKeyValueNamespace =
      defaultDatabaseCapabilities(driver).dataModel === "keyValue";
    const key = schemaTreeKey(connectionId, driver, schema);
    const isExpanded = expandedSchemaKeys.includes(key);

    if (isExpanded) {
      setExpandedSchemaKeys((current) =>
        current.filter((item) => item !== key),
      );
      return;
    }

    // Acknowledge expansion before any connection, cache, or backend schema
    // work. Non-default namespaces used to look unclickable while these awaits
    // were still pending, whereas the already-selected default opened at once.
    setExpandedSchemaKeys((current) =>
      isKeyValueNamespace
        ? [key]
        : current.includes(key)
          ? current
          : [...current, key],
    );
    const objectsKey = objectGroupKey(connectionId, driver, schema, "objects");
    setExpandedObjectGroupKeys((current) =>
      isKeyValueNamespace
        ? [objectsKey]
        : current.includes(objectsKey)
          ? current
          : [...current, objectsKey],
    );

    try {
      if (connectionId !== activeConnectionId) {
        const connectionError = await setActiveConnection(connectionId);
        if (connectionError) throw new Error(connectionError);
      }

      if (connectionId !== activeConnectionId || !isCurrentSchema) {
        await handleSchemaSelect(schema);
      }
      if (!shouldAutoIntrospect) {
        await hydrateSchemaObjectsFromCache(connectionId, schema);
      }
      setNamespaceError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNamespaceError(
        `Could not open ${namespaceLabel} "${schema}": ${message}`,
      );
      throw error;
    }
  };

  useEffect(() => {
    if (!databaseRevealRequest) return;
    const { id: requestId, target } = databaseRevealRequest;
    if (target.projectId !== activeProjectId) return;
    const connection = connections.find(
      (item) => item.id === target.connectionId,
    );
    if (!connection) {
      clearDatabaseReveal(requestId);
      return;
    }

    let cancelled = false;
    void (async () => {
      if (useConnectionStore.getState().activeConnectionId !== connection.id) {
        const connectionError = await setActiveConnection(connection.id);
        if (connectionError || cancelled) return;
      }
      setExpandedConnectionIds((current) =>
        current.includes(connection.id) ? current : [...current, connection.id],
      );

      const currentDatabase = supportsDatabaseCatalogTree(connection.driver)
        ? connectionCatalogDatabaseName(connection)
        : connection.database || "";
      if (
        supportsDatabaseCatalogTree(connection.driver) &&
        target.databaseName &&
        target.databaseName !== currentDatabase
      ) {
        await loadPostgresRemoteDatabase(connection.id, target.databaseName);
        if (!target.schemaName) {
          setFilterText("");
          window.requestAnimationFrame(() => {
            const databaseRow = Array.from(
              document.querySelectorAll<HTMLElement>(
                "[data-postgres-database]",
              ),
            ).find(
              (element) =>
                element.dataset.postgresDatabase === target.databaseName,
            );
            databaseRow?.querySelector<HTMLElement>("button")?.focus();
            clearDatabaseReveal(requestId);
          });
        }
        return;
      }

      if (!target.schemaName) {
        setFilterText("");
        window.requestAnimationFrame(() => {
          const databaseRow = Array.from(
            document.querySelectorAll<HTMLElement>("[data-postgres-database]"),
          ).find(
            (element) =>
              element.dataset.postgresDatabase === target.databaseName,
          );
          databaseRow?.querySelector<HTMLElement>("button")?.focus();
          clearDatabaseReveal(requestId);
        });
        return;
      }

      await handleSchemaSelect(target.schemaName);
      if (target.objectName && !shouldAutoIntrospect) {
        await hydrateSchemaObjectsFromCache(connection.id, target.schemaName);
      }
      if (cancelled) return;
      const schemaKey = schemaTreeKey(
        connection.id,
        connection.driver,
        target.schemaName,
      );
      setExpandedSchemaKeys((current) =>
        current.includes(schemaKey) ? current : [...current, schemaKey],
      );
      setFilterText("");
      window.requestAnimationFrame(() => {
        const databaseName =
          target.databaseName ||
          (supportsDatabaseCatalogTree(connection.driver)
            ? currentDatabase || undefined
            : undefined);
        const key = target.objectName
          ? databaseObjectNavigationKey({
              ...target,
              objectName: target.objectName,
              databaseName,
            })
          : databaseSchemaNavigationKey({
              ...target,
              databaseName,
            });
        const element = document.querySelector<HTMLElement>(
          target.objectName
            ? `[data-database-object-key="${key}"]`
            : `[data-database-schema-key="${key}"]`,
        );
        element?.scrollIntoView({ block: "nearest" });
        element?.focus();
        clearDatabaseReveal(requestId);
      });
      if (target.objectName) {
        const objectsKey = objectGroupKey(
          connection.id,
          connection.driver,
          target.schemaName,
          "objects",
        );
        setExpandedObjectGroupKeys((current) =>
          current.includes(objectsKey) ? current : [...current, objectsKey],
        );
        selectTable(target.objectName);
      }
    })().catch((error) => {
      if (!cancelled) {
        setNamespaceError(
          error instanceof Error ? error.message : String(error),
        );
        clearDatabaseReveal(requestId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [databaseRevealRequest?.id]);

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

  const renderSchemaObjects = (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    _connectionColor: string,
  ) => {
    const isCurrentSchema =
      connectionId === activeConnectionId && schema === currentSchema;
    const objectConnection = connections.find(
      (connection) => connection.id === connectionId,
    );
    const objectDriver = objectConnection?.driver;
    const navigationDatabaseName =
      objectConnection && supportsDatabaseCatalogTree(objectConnection.driver)
        ? connectionCatalogDatabaseName(objectConnection)
        : undefined;
    const schemaObjects = schemaObjectsFor(connectionId, driver, schema);
    const tableRelations = schemaObjects.tables.filter(
      (table) => !isViewObject(table.type),
    );
    const tableRelationNames = tableRelations.map((table) => table.name);
    const virtualViews = schemaObjects.tables.filter((table) =>
      isViewObject(table.type),
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
    const isTableBatchSelectionActive =
      tableBatchSelection?.scopeKey === groupKey;
    const scopedTableBatchSelection = isTableBatchSelectionActive
      ? pruneTableBatchSelection(tableBatchSelection, tableRelationNames)
      : { names: [], anchor: null };
    const selectedTableBatchNames = scopedTableBatchSelection.names;
    const selectedTableBatchSet = new Set(selectedTableBatchNames);
    const allVisibleTablesSelected =
      tableRelationNames.length > 0 &&
      tableRelationNames.every((name) => selectedTableBatchSet.has(name));
    const schemaNodeState =
      metadataNodeStates[
        getSchemaMetadataNodeKey(connectionId, driver, schema)
      ];
    const isSchemaObjectsLoading =
      schemaNodeState?.status === "loading" ||
      (isCurrentSchema && isLoading && schemaObjects.tables.length === 0);

    const addTablesToAssistant = async (tableNames: readonly string[]) => {
      if (!objectConnection || tableNames.length === 0) return;
      const targetDatabase =
        navigationDatabaseName || objectConnection.database || undefined;
      const tabStateBefore = useTabStore.getState();
      const activeTabBefore = tabStateBefore.tabs.find(
        (tab) => tab.id === tabStateBefore.activeTabId,
      );
      const matchesTargetContext = (tab: typeof activeTabBefore) =>
        Boolean(
          tab &&
          tab.connectionId === connectionId &&
          (tab.databaseName || objectConnection.database || "") ===
            (targetDatabase || "") &&
          (tab.schemaName || "") === schema,
        );
      const contextChanged = !matchesTargetContext(activeTabBefore);
      const connectionError = await setActiveConnection(connectionId);
      if (connectionError) {
        setNamespaceError(connectionError);
        return;
      }
      if (schema !== useSchemaStore.getState().currentSchema) {
        await setCurrentSchema(schema);
      }
      const tabState = useTabStore.getState();
      if (!matchesTargetContext(activeTabBefore)) {
        const contextTab = tabState.tabs.find(
          (tab) => tab.type === "query" && matchesTargetContext(tab),
        );
        if (contextTab) {
          tabState.setActiveTab(contextTab.id);
        } else {
          tabState.createTab("query", "New Query", "", {
            connectionId,
            databaseName: targetDatabase,
            schemaName: schema,
          });
        }
      }
      const request = useAssistantComposerStore.getState().queueDatabaseTables(
        tableNames.map((table) => ({
          connectionId,
          connectionName: objectConnection.name,
          database: targetDatabase,
          schema,
          table,
        })),
        { replaceExisting: contextChanged },
      );
      if (!request) return;
      setNamespaceError(null);
      window.dispatchEvent(new CustomEvent(APP_EVENT_OPEN_ASSISTANT));
    };

    const tableReferencePayload = (tableNames: readonly string[]) =>
      createExplorerTableReferencePayload({
        connectionId,
        database:
          navigationDatabaseName || objectConnection?.database || undefined,
        schema,
        tables: tableNames,
        identifierQuote: activeCapabilities.identifierQuote,
      });

    const routinesKey = objectGroupKey(
      connectionId,
      driver,
      schema,
      "routines",
    );
    const virtualViewsKey = objectGroupKey(
      connectionId,
      driver,
      schema,
      "virtual-views",
    );
    const descriptorObjectsKey = objectGroupKey(
      connectionId,
      driver,
      schema,
      "schema-descriptors",
    );
    const descriptorObjects =
      isCurrentSchema &&
      schemaObjectDescriptorScope === `${connectionId}:${schema}`
        ? schemaObjectDescriptors
            .filter((object) =>
              object.name.toLowerCase().includes(filterText.toLowerCase()),
            )
            .sort((left, right) =>
              left.objectType === right.objectType
                ? left.name.localeCompare(right.name)
                : left.objectType.localeCompare(right.objectType),
            )
        : [];

    const toggleObjectGroup = (key: string) => {
      setExpandedObjectGroupKeys((current) =>
        current.includes(key)
          ? current.filter((item) => item !== key)
          : [...current, key],
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

    const renderRoutines = () => {
      if (!activeCapabilities.supportsFunctions) return null;
      const isExpanded = expandedObjectGroupKeys.includes(routinesKey);
      const functions = schemaObjects.functions.filter(
        (routine) => routineKind(routine) === "function",
      );
      const procedures = schemaObjects.functions.filter(
        (routine) => routineKind(routine) === "procedure",
      );

      const renderRoutineRow = (routine: FunctionInfo, index: number) => {
        const signature = routineSignature(routine);
        const returnType = routine.return_type || "unknown";
        const qualifiedName = schema
          ? `${schema}.${routine.name}`
          : routine.name;

        return (
          <ContextMenu key={`${routine.name}:${signature}:${index}`}>
            <ContextMenuTrigger asChild>
              <div
                className="group ml-4 flex h-6 items-center gap-2 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                title={
                  showExplorerHoverTooltips
                    ? `${signature} -> ${returnType}`
                    : undefined
                }
              >
                <Code2 size={12} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">
                  {highlightMatch(routine.name, filterText)}
                </span>
                <span className="shrink-0 text-[9px] uppercase opacity-50">
                  {routineKindLabel(routine)}
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className={menuContentClass}>
              <ContextMenuItem
                className={menuItemClass}
                onClick={() => void copyText(qualifiedName)}
              >
                Copy qualified name
              </ContextMenuItem>
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  void copyText(routineCallTemplate(schema, routine))
                }
              >
                Copy call template
              </ContextMenuItem>
              {activeConnectionId &&
                ["postgres", "postgresql", "pgsql"].includes(
                  activeDriver.toLowerCase(),
                ) && (
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() =>
                      void loadPostgresRoutineDefinitions({
                        projectId: activeProjectId || "local",
                        connectionId: activeConnectionId,
                        driver: activeDriver,
                        driverPackageVersion:
                          activeConnection?.driverPackageVersion,
                        connectionDatabaseName: activeConnection?.database,
                        schema,
                        routine: routine.name,
                      })
                        .then((definitions) =>
                          copyText(definitions.join("\n\n")),
                        )
                        .catch((error) =>
                          window.alert(
                            `Failed to load routine definition: ${error instanceof Error ? error.message : String(error)}`,
                          ),
                        )
                    }
                  >
                    Copy source definition
                  </ContextMenuItem>
                )}
            </ContextMenuContent>
          </ContextMenu>
        );
      };

      const renderRoutineKind = (label: string, routines: FunctionInfo[]) => {
        if (routines.length === 0) return null;

        return (
          <div>
            <div className="ml-4 flex h-6 items-center gap-2 px-2 text-[10px] text-[hsl(var(--wb-text-muted))]">
              <Folder size={11} className="shrink-0 opacity-60" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="text-[9px] opacity-60">{routines.length}</span>
            </div>
            {routines.map(renderRoutineRow)}
          </div>
        );
      };

      return (
        <div>
          <button
            type="button"
            className="wb-tree-row w-full gap-1.5 px-0.5 hover:bg-[hsl(var(--wb-hover))]"
            onClick={() => toggleObjectGroup(routinesKey)}
          >
            {isExpanded ? (
              <ChevronDown size={12} className="shrink-0 wb-muted" />
            ) : (
              <ChevronRight size={12} className="shrink-0 wb-muted" />
            )}
            <FolderCog size={12} className="shrink-0 text-sky-400/80" />
            <span className="truncate text-[11px] text-[hsl(var(--wb-text))]">
              Routines
            </span>
            {!isFunctionsLoading && (
              <span className="text-[9px] wb-muted">
                {schemaObjects.functions.length}
              </span>
            )}
          </button>
          {isExpanded &&
            (isCurrentSchema &&
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
              <>
                {renderRoutineKind("Functions", functions)}
                {renderRoutineKind("Procedures", procedures)}
              </>
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
              <div className="pl-7 text-[11px] italic wb-muted">
                No views found
              </div>
            ) : (
              virtualViews.map((view) => {
                const isSelectedView =
                  isCurrentSchema && selectedTable === view.name;
                return (
                  <ContextMenu key={`${schema}:view:${view.name}`}>
                    <ContextMenuTrigger asChild>
                      <div
                        data-database-object-key={databaseObjectNavigationKey({
                          connectionId,
                          databaseName: navigationDatabaseName,
                          schemaName: schema,
                          objectName: view.name,
                        })}
                        tabIndex={-1}
                        className={cn(
                          "group ml-4 flex h-6 cursor-pointer items-center gap-2 rounded-[3px] px-2 text-[11px]",
                          isSelectedView
                            ? "wb-tree-row-selected"
                            : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                        )}
                        onClick={(event) => {
                          if (
                            shouldActivateExplorerObject(
                              explorerActivationMode,
                              "click",
                              event.detail,
                            )
                          ) {
                            void handleTableDoubleClick(view, schema);
                            return;
                          }
                          void runForSchema(schema, () =>
                            handleTableSelect(view.name),
                          );
                        }}
                        onDoubleClick={() => {
                          if (
                            shouldActivateExplorerObject(
                              explorerActivationMode,
                              "double-click",
                            )
                          ) {
                            void handleTableDoubleClick(view, schema);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          event.preventDefault();
                          void handleTableDoubleClick(view, schema);
                        }}
                        title={`${explorerActivationLabel(explorerActivationMode)} to open ${schema}.${view.name} data`}
                      >
                        <TableProperties
                          size={12}
                          className="shrink-0 opacity-75"
                        />
                        <span className="truncate">{view.name}</span>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={menuContentClass}>
                      <ContextMenuItem
                        className={menuItemClass}
                        onClick={() =>
                          void handleTableDoubleClick(view, schema)
                        }
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

    const renderSchemaObjectDescriptors = () => {
      if (!isCurrentSchema || activeCapabilities.dataModel !== "relational") {
        return null;
      }
      const isExpanded = expandedObjectGroupKeys.includes(descriptorObjectsKey);
      return (
        <div>
          <button
            type="button"
            className="wb-tree-row w-full gap-1.5 px-0.5 hover:bg-[hsl(var(--wb-hover))]"
            onClick={() => toggleObjectGroup(descriptorObjectsKey)}
          >
            {isExpanded ? (
              <ChevronDown size={12} className="shrink-0 wb-muted" />
            ) : (
              <ChevronRight size={12} className="shrink-0 wb-muted" />
            )}
            <Folder size={12} className="shrink-0 text-amber-400/80" />
            <span className="truncate text-[11px] text-[hsl(var(--wb-text))]">
              Schema objects
            </span>
            {!isSchemaObjectDescriptorsLoading && (
              <span className="text-[9px] wb-muted">
                {descriptorObjects.length}
              </span>
            )}
          </button>
          {isExpanded &&
            (isSchemaObjectDescriptorsLoading &&
            descriptorObjects.length === 0 ? (
              <div className="pl-7 text-[11px] italic wb-muted">
                Loading schema objects...
              </div>
            ) : descriptorObjects.length === 0 ? (
              <div className="pl-7 text-[11px] italic wb-muted">
                {filterText
                  ? `No schema objects match "${filterText}"`
                  : "No supported schema objects found"}
              </div>
            ) : (
              descriptorObjects.map((object) => {
                const objectType = object.objectType.toLowerCase();
                const parentSuffix = object.parentName
                  ? ` on ${object.parentName}`
                  : "";
                const qualifiedName = schema
                  ? `${schema}.${object.name}`
                  : object.name;
                const memberKey = [
                  connectionId,
                  navigationDatabaseName || "",
                  schema,
                  object.objectType,
                  object.name,
                ].join("\u0000");
                const membersState = schemaObjectMemberStates[memberKey];
                const membersExpanded =
                  expandedSchemaObjectMemberKeys.includes(memberKey);
                const toggleMembers = () => {
                  if (!object.membersExpandable) return;
                  // Retry keeps a failed node expanded so the operation does
                  // not look like a collapse. A successful cached response
                  // toggles without another round trip.
                  if (membersExpanded && !membersState?.error) {
                    setExpandedSchemaObjectMemberKeys((current) =>
                      current.filter((key) => key !== memberKey),
                    );
                    return;
                  }
                  if (!membersExpanded) {
                    setExpandedSchemaObjectMemberKeys((current) => [
                      ...current,
                      memberKey,
                    ]);
                  }
                  if (membersState && !membersState.error) return;
                  setSchemaObjectMemberStates((current) => ({
                    ...current,
                    [memberKey]: { loading: true, error: false, members: [] },
                  }));
                  void schemaService
                    .getSchemaObjectMembers(
                      connectionId,
                      schema,
                      object.name,
                      object.objectType,
                    )
                    .then((members) => {
                      setSchemaObjectMemberStates((current) => ({
                        ...current,
                        [memberKey]: { loading: false, error: false, members },
                      }));
                    })
                    .catch(() => {
                      setSchemaObjectMemberStates((current) => ({
                        ...current,
                        [memberKey]: {
                          loading: false,
                          error: true,
                          members: [],
                        },
                      }));
                    });
                };
                const viewObjectSource = () => {
                  void schemaService
                    .getSchemaObjectSource(
                      connectionId,
                      schema,
                      object.name,
                      object.objectType,
                      object.parentName,
                    )
                    .then((definitions) => {
                      const definition = definitions.find(
                        (value) => value.trim().length > 0,
                      );
                      if (!definition) {
                        throw new Error(
                          "This driver does not provide a source definition for the selected object.",
                        );
                      }
                      setActiveTable(object.name);
                      setDdlContent(definition);
                      setDdlViewerOpen(true);
                    })
                    .catch((error) => {
                      window.alert(
                        `Unable to load ${object.objectType.toLowerCase()} definition: ${error instanceof Error ? error.message : String(error)}`,
                      );
                    });
                };
                return (
                  <div
                    key={`${objectType}:${object.name}:${object.parentName || ""}`}
                  >
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <div
                          className="group ml-4 flex h-6 items-center gap-2 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                          title={
                            showExplorerHoverTooltips
                              ? `${object.objectType}${parentSuffix}${object.comment ? `\n${object.comment}` : ""}`
                              : undefined
                          }
                        >
                          {object.membersExpandable ? (
                            <button
                              type="button"
                              className="-ml-1 -mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                              aria-label={`${membersExpanded ? "Collapse" : "Expand"} ${object.name} members`}
                              aria-expanded={membersExpanded}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleMembers();
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              {membersExpanded ? (
                                <ChevronDown size={10} />
                              ) : (
                                <ChevronRight size={10} />
                              )}
                            </button>
                          ) : null}
                          {objectType === "sequence" ? (
                            <KeyRound
                              size={12}
                              className="shrink-0 text-amber-400/80"
                            />
                          ) : objectType === "trigger" ? (
                            <Network
                              size={12}
                              className="shrink-0 text-sky-400/80"
                            />
                          ) : (
                            <Folder
                              size={12}
                              className="shrink-0 text-violet-400/80"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {highlightMatch(object.name, filterText)}
                          </span>
                          <span className="shrink-0 text-[9px] uppercase opacity-50">
                            {object.objectType}
                            {parentSuffix}
                          </span>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className={menuContentClass}>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() => void copyText(qualifiedName)}
                        >
                          Copy qualified name
                        </ContextMenuItem>
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={viewObjectSource}
                        >
                          View definition
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    {object.membersExpandable && membersExpanded && (
                      <div className="ml-10 border-l border-[hsl(var(--wb-border-subtle))] pl-2">
                        {membersState?.loading ? (
                          <div className="py-1 text-[10px] italic wb-muted">
                            Loading members...
                          </div>
                        ) : membersState?.error ? (
                          <button
                            type="button"
                            className="wb-text-button h-5 px-1 text-[10px] text-[hsl(var(--wb-danger))]"
                            onClick={toggleMembers}
                          >
                            Unable to load members; retry
                          </button>
                        ) : membersState?.members.length ? (
                          membersState.members.map((member) => (
                            <div
                              key={`${member.objectType}:${member.name}`}
                              className="flex min-w-0 items-center gap-1 py-0.5 text-[10px] text-[hsl(var(--wb-text-muted))]"
                              title={member.comment || member.objectType}
                            >
                              <Folder
                                size={10}
                                className="shrink-0 text-violet-400/70"
                              />
                              <span className="truncate">{member.name}</span>
                              <span className="ml-auto shrink-0 uppercase opacity-50">
                                {member.objectType}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="py-1 text-[10px] italic wb-muted">
                            No members found
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ))}
        </div>
      );
    };

    const renderCollectionItem = (
      collection: CollectionInfo,
      label: string | undefined = undefined,
      depth = 0,
    ) => {
      const canDeleteCollection = Boolean(collectionDeleteSql(collection));
      const collectionDriver = driver || activeDriver;
      const displayLabel =
        label ??
        collectionDisplayLabelForCapabilities(activeCapabilities, collection);
      const isElasticsearchIndex =
        normalizeDatabaseDriverName(collectionDriver) === "elasticsearch" &&
        collection.type === "index";
      const isMongoCollection =
        normalizeDatabaseDriverName(collectionDriver) === "mongodb" &&
        activeCapabilities.dataModel === "document";
      const nacosLocation =
        normalizeDatabaseDriverName(collectionDriver) === "nacos"
          ? nacosLocationFromCollection(collection)
          : null;
      const isSelectedCollection =
        isCurrentSchema && selectedTable === collection.name;
      const canExpandCollectionMetadata =
        activeCapabilities.dataModel === "document" ||
        activeCapabilities.dataModel === "search";
      const collectionTreeKey = tableTreeKey(
        connectionId,
        driver,
        navigationDatabaseName,
        schema,
        collection.name,
      );
      const isCollectionExpanded =
        expandedTableKeys.includes(collectionTreeKey);

      return (
        <div key={`${schema}:${collection.name}`}>
          <ContextMenu>
            <ContextMenuTrigger>
              <div
                data-database-object-key={databaseObjectNavigationKey({
                  connectionId,
                  databaseName: navigationDatabaseName,
                  schemaName: schema,
                  objectName: collection.name,
                })}
                tabIndex={-1}
                className={cn(
                  "group flex cursor-pointer select-none items-center gap-2 rounded-[3px] py-1 pr-2 text-[11px] transition-colors",
                  isSelectedCollection
                    ? "wb-tree-row-selected"
                    : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]",
                )}
                style={{ paddingLeft: `${8 + depth * 14}px` }}
                onClick={(event) => {
                  if (
                    shouldActivateExplorerObject(
                      explorerActivationMode,
                      "click",
                      event.detail,
                    )
                  ) {
                    void runForSchema(schema, () =>
                      handleCollectionDoubleClick(collection),
                    );
                    return;
                  }
                  void runForSchema(schema, () =>
                    handleCollectionSelect(collection.name),
                  );
                }}
                onDoubleClick={() => {
                  if (
                    shouldActivateExplorerObject(
                      explorerActivationMode,
                      "double-click",
                    )
                  ) {
                    void runForSchema(schema, () =>
                      handleCollectionDoubleClick(collection),
                    );
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void runForSchema(schema, () =>
                    handleCollectionDoubleClick(collection),
                  );
                }}
                title={
                  showExplorerHoverTooltips
                    ? displayLabel === collection.name
                      ? collection.name
                      : `${displayLabel}\n${collection.name}`
                    : undefined
                }
                aria-label={`${displayLabel}. ${explorerActivationLabel(explorerActivationMode)} to open data.`}
              >
                {canExpandCollectionMetadata && (
                  <button
                    type="button"
                    className="-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                    aria-label={`${isCollectionExpanded ? "Collapse" : "Expand"} ${collection.name} metadata`}
                    aria-expanded={isCollectionExpanded}
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedTableKeys((current) =>
                        current.includes(collectionTreeKey)
                          ? current.filter((key) => key !== collectionTreeKey)
                          : [...current, collectionTreeKey],
                      );
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {isCollectionExpanded ? (
                      <ChevronDown size={10} />
                    ) : (
                      <ChevronRight size={10} />
                    )}
                  </button>
                )}
                <KeyRound
                  size={12}
                  className={cn(
                    "shrink-0 text-red-400/80",
                    isSelectedCollection && "opacity-100",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {highlightMatch(displayLabel || "(empty)", filterText)}
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
                    handleCollectionDoubleClick(collection),
                  )
                }
              >
                <TableProperties className="mr-2 h-3.5 w-3.5" />
                Open Data
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  void runForSchema(schema, () =>
                    handleCopyCollectionPreview(collection),
                  )
                }
              >
                <Clipboard className="mr-2 h-3.5 w-3.5" />
                Copy Preview Query
              </ContextMenuItem>
              {isElasticsearchIndex && (
                <>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <Code2 className="mr-2 h-3.5 w-3.5" />
                      Index Metadata
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="w-44">
                      {(
                        [
                          ["mapping", "View Mapping"],
                          ["settings", "View Settings"],
                          ["stats", "View Statistics"],
                        ] as const
                      ).map(([kind, metadataLabel]) => (
                        <ContextMenuItem
                          key={kind}
                          onClick={() =>
                            setElasticsearchMetadataTarget({
                              connectionId,
                              driver: collectionDriver,
                              index: collection.name,
                              kind,
                            })
                          }
                        >
                          {metadataLabel}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuItem
                    onClick={() =>
                      setElasticsearchClearTarget({
                        connectionId,
                        driver: collectionDriver,
                        schema,
                        index: collection.name,
                      })
                    }
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    Clear Documents…
                  </ContextMenuItem>
                </>
              )}
              {nacosLocation && (
                <ContextMenuItem
                  onClick={() =>
                    setNacosConfigTransferRequest({
                      sourceConnectionId: connectionId,
                      sourceConnectionName:
                        connections.find(
                          (candidate) => candidate.id === connectionId,
                        )?.name || "Nacos connection",
                      source: nacosLocation,
                    })
                  }
                >
                  <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                  Transfer Configuration…
                </ContextMenuItem>
              )}
              {isMongoCollection && (
                <ContextMenuItem
                  onClick={() =>
                    setMongoCollectionTransferRequest({
                      sourceConnectionId: connectionId,
                      sourceConnectionName:
                        connections.find(
                          (candidate) => candidate.id === connectionId,
                        )?.name || "MongoDB connection",
                      sourceDatabase: navigationDatabaseName || schema,
                      sourceCollection: collection.name,
                    })
                  }
                >
                  <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                  Transfer Collection…
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() =>
                  void runForSchema(schema, () =>
                    handleDeleteCollectionClick(collection),
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
          {canExpandCollectionMetadata && isCollectionExpanded && (
            <TableObjectTree
              identity={{
                projectId: activeProjectId,
                connectionId,
                driver: driver || activeDriver,
                databaseName: navigationDatabaseName || undefined,
                schema,
                table: collection.name,
              }}
              includeIndexes={activeCapabilities.supportsTableIndexes}
              includeConstraints={false}
            />
          )}
        </div>
      );
    };

    const renderRedisKeyNodes = (
      nodes: RedisKeyTreeNode<CollectionInfo>[],
      depth = 0,
    ): ReactNode =>
      nodes.map((node) => {
        if (node.children.length === 0 && node.key) {
          return renderCollectionItem(node.key, node.segment, depth);
        }

        const key = objectGroupKey(
          connectionId,
          driver,
          schema,
          `redis:${node.path}`,
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
                {node.key && renderCollectionItem(node.key, "(key)", depth + 1)}
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
          data-database-schema-key={databaseSchemaNavigationKey({
            connectionId,
            databaseName: navigationDatabaseName,
            schemaName: schema,
          })}
          className="flex h-6 w-full items-center justify-between rounded-[3px] pr-1 text-left hover:bg-[hsl(var(--wb-hover))]"
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
                        buildRedisKeyTree(schemaObjects.collections),
                      )
                    : schemaObjects.collections.map((collection) =>
                        renderCollectionItem(collection),
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
                    table.name,
                  );
                  const isView = isViewObject(table.type);
                  const isMaterializedView = isMaterializedViewObject(
                    table.type,
                  );
                  const isReadOnlyRelation = isReadOnlyRelationObject(
                    table.type,
                  );
                  const isSelectedTable =
                    isCurrentSchema && selectedTable === table.name;
                  const relationTreeKey = tableTreeKey(
                    connectionId,
                    driver,
                    navigationDatabaseName,
                    schema,
                    table.name,
                  );
                  const isTableExpanded =
                    expandedTableKeys.includes(relationTreeKey);
                  // A pinned external package may expose a narrower object
                  // contract than the globally active version of the same
                  // driver. The active connection has already resolved its
                  // own runtime capability snapshot above; never replace it
                  // with the global default while rendering its table actions.
                  const relationCapabilities = isCurrentSchema
                    ? activeCapabilities
                    : defaultDatabaseCapabilities(driver || activeDriver);
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
                  ) =>
                    relationCapabilities.tableExportFormats?.includes(
                      format,
                    ) === true;
                  const canImportRelationRows =
                    !isReadOnlyRelation &&
                    relationCapabilities.supportsTableRowMutation;
                  const contextualTableNames =
                    selectedTableBatchSet.has(table.name) &&
                    selectedTableBatchNames.length > 0
                      ? selectedTableBatchNames
                      : [table.name];

                  return (
                    <div key={`${schema}:${table.name}`}>
                      <ContextMenu
                        onOpenChange={(open) => {
                          if (open) {
                            void runForSchema(schema, () =>
                              handleTableSelect(table.name),
                            );
                          }
                        }}
                      >
                        <ContextMenuTrigger asChild>
                          <div
                            data-database-object-key={databaseObjectNavigationKey(
                              {
                                connectionId,
                                databaseName: navigationDatabaseName,
                                schemaName: schema,
                                objectName: table.name,
                              },
                            )}
                            tabIndex={-1}
                            aria-label={`${relationObjectLabel(table.type)} ${schema}.${table.name}. ${explorerActivationLabel(explorerActivationMode)} to open data; right-click for actions; expand for columns and indexes.`}
                            className={cn(
                              "group flex cursor-pointer select-none items-center gap-2 rounded-[3px] px-2 py-1 text-[11px] transition-colors",
                              selectedTableBatchSet.has(table.name) ||
                                isSelectedTable
                                ? "wb-tree-row-selected"
                                : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]",
                            )}
                            onClick={(event) => {
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
                              if (
                                event.ctrlKey ||
                                event.metaKey ||
                                event.shiftKey
                              ) {
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
                                void handleTableDoubleClick(table, schema);
                                return;
                              }
                              void runForSchema(schema, () =>
                                handleTableSelect(table.name),
                              );
                            }}
                            onDoubleClick={() => {
                              if (
                                !isTableBatchSelectionActive &&
                                shouldActivateExplorerObject(
                                  explorerActivationMode,
                                  "double-click",
                                )
                              ) {
                                void handleTableDoubleClick(table, schema);
                              }
                            }}
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
                              const payload =
                                tableReferencePayload(draggedTables);
                              if (!payload) return;
                              beginExplorerTableReferenceDrag(
                                event.nativeEvent,
                                {
                                  payload,
                                  label:
                                    explorerTableReferenceDragLabel(payload),
                                  onFinish: (dragged) => {
                                    if (dragged) {
                                      suppressTableReferenceClickRef.current = true;
                                      window.setTimeout(() => {
                                        suppressTableReferenceClickRef.current = false;
                                      }, 0);
                                    }
                                  },
                                },
                              );
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key !== "Enter" ||
                                isTableBatchSelectionActive
                              )
                                return;
                              event.preventDefault();
                              void handleTableDoubleClick(table, schema);
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
                                    ? current.filter(
                                        (key) => key !== relationTreeKey,
                                      )
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
                                  isView ? "view" : "table",
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
                                  void runForSchema(schema, () =>
                                    togglePinTable(table.name),
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
                          <ContextMenuItem
                            className={menuItemClass}
                            disabled={
                              !relationCapabilities.supportsSqlQuery ||
                              !relationCapabilities.supportsTableBrowsing
                            }
                            onClick={() =>
                              window.dispatchEvent(
                                new CustomEvent(
                                  APP_EVENT_OPEN_DATABASE_SEARCH,
                                  {
                                    detail: {
                                      connectionId,
                                      database: navigationDatabaseName,
                                      schema,
                                      table: table.name,
                                    },
                                  },
                                ),
                              )
                            }
                          >
                            <Search className="mr-2 h-3.5 w-3.5" />
                            Search Table Rows...
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={menuItemClass}
                            disabled={
                              !objectConnection ||
                              !(
                                supportsTableWorkspace(relationCapabilities) ||
                                relationCapabilities.supportsCollectionBrowsing
                              )
                            }
                            onClick={() => {
                              if (!objectConnection) return;
                              void setActiveConnection(connectionId).then(
                                (connectionError) => {
                                  if (connectionError) {
                                    setNamespaceError(connectionError);
                                    return;
                                  }
                                  setSchemaSnapshotIdentity({
                                    projectId: activeProjectId,
                                    connectionId,
                                    connectionName: objectConnection.name,
                                    driver: objectConnection.driver,
                                    databaseName: navigationDatabaseName,
                                    schemaName: schema,
                                    tableName: table.name,
                                  });
                                },
                              );
                            }}
                          >
                            <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                            Schema Snapshots / Diff...
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={menuItemClass}
                            disabled={!objectConnection}
                            onClick={() =>
                              void addTablesToAssistant(contextualTableNames)
                            }
                          >
                            <Sparkles className="mr-2 h-3.5 w-3.5" />
                            Add{" "}
                            {contextualTableNames.length > 1
                              ? "tables"
                              : "table"}{" "}
                            to AI context
                          </ContextMenuItem>
                          <ContextMenuSeparator
                            className={menuSeparatorClass}
                          />
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
                                      createTableTab(
                                        activeConnectionId,
                                        schema,
                                      );
                                    }
                                  })
                                }
                                disabled={
                                  !activeConnectionId ||
                                  !canBrowseTables ||
                                  !activeCapabilities.supportsTableDdl
                                }
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
                                    handleCreateMaterializedView,
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
                                    handleCopyTableDdl(table),
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
                                  await loadTables(
                                    activeConnectionId,
                                    schema,
                                    true,
                                  );
                                  if (activeCapabilities.supportsFunctions) {
                                    await loadFunctions(
                                      activeConnectionId,
                                      schema,
                                      true,
                                    );
                                  }
                                }
                                if (canBrowseCollections) {
                                  await loadCollections(
                                    activeConnectionId,
                                    schema,
                                    true,
                                  );
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
                            disabled={!relationCapabilities.supportsTableDdl}
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleRenameClick(table),
                              )
                            }
                          >
                            Rename...
                            <ContextMenuShortcut>⇧F6</ContextMenuShortcut>
                          </ContextMenuItem>
                          <ContextMenuSeparator
                            className={menuSeparatorClass}
                          />

                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleDdlClick(table),
                              )
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
                                    handleDdlClick(table),
                                  )
                                }
                              >
                                Go to DDL
                              </ContextMenuItem>
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuSeparator
                            className={menuSeparatorClass}
                          />

                          <ContextMenuSub>
                            <ContextMenuSubTrigger className={menuSubClass}>
                              SQL Scripts
                            </ContextMenuSubTrigger>
                            <ContextMenuSubContent className={menuContentClass}>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleDdlClick(table),
                                  )
                                }
                              >
                                Show DDL
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleCopyTableDdl(table),
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
                                    togglePinTable(table.name),
                                  )
                                }
                              >
                                {isPinned ? "Unpin" : "Pin"}
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleEditColumnsClick(table),
                                  )
                                }
                                disabled={
                                  isReadOnlyRelation ||
                                  !relationCapabilities.supportsTableDdl ||
                                  !relationCapabilities.supportsColumnAlteration
                                }
                              >
                                Edit Columns
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleTruncateClick(table),
                                  )
                                }
                                disabled={
                                  isReadOnlyRelation ||
                                  !relationCapabilities.supportsTableDdl
                                }
                              >
                                Empty Table
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() => {
                                  if (!objectConnection) return;
                                  setDatabaseMaintenanceTarget({
                                    connectionId,
                                    connectionName: objectConnection.name,
                                    driver: objectConnection.driver,
                                    database:
                                      objectConnection.driver === "postgres"
                                        ? navigationDatabaseName
                                        : undefined,
                                    schema,
                                    table: table.name,
                                  });
                                }}
                                disabled={
                                  isReadOnlyRelation ||
                                  !objectConnection ||
                                  !supportsDatabaseAdministration(
                                    objectDriver,
                                  ) ||
                                  Boolean(objectConnection.driverPackageVersion)
                                }
                              >
                                <Wrench className="mr-2 h-3.5 w-3.5" />
                                Maintain Table...
                              </ContextMenuItem>
                              {isView && !isMaterializedView && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      handleEditViewClick(table),
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
                                      handleRefreshMaterializedViewClick(table),
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
                                disabled={!canImportRelationRows}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleTableCsvImport(table, schema),
                                  )
                                }
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Import CSV / TSV...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                disabled={!canImportRelationRows}
                                title="Stream auto-detected UTF-8, UTF-16, or GB18030 delimited text. TSV defaults to a tab delimiter; CSV and TXT default to a comma. Use the reviewed import when you need row ranges or column mapping."
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    importTableData(table.name, "csv"),
                                  )
                                }
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Import delimited text (streaming)...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                disabled={!canImportRelationRows}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleTableJsonImport(table, schema),
                                  )
                                }
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Import JSON...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                disabled={!canImportRelationRows}
                                onClick={() =>
                                  void runForSchema(schema, () =>
                                    handleTableXlsxImport(table, schema),
                                  )
                                }
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Import XLSX...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                disabled={
                                  !relationCapabilities.supportsSqlQuery
                                }
                                onClick={() =>
                                  void handleImportSqlScript({
                                    connectionId,
                                    schema,
                                    database: supportsDatabaseCatalogTree(
                                      driver,
                                    )
                                      ? connectionCatalogDatabaseName(
                                          connections.find(
                                            (item) => item.id === connectionId,
                                          ) || {},
                                        )
                                      : undefined,
                                  })
                                }
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Import SQL Script...
                              </ContextMenuItem>
                              <ContextMenuSeparator
                                className={menuSeparatorClass}
                              />
                              {supportsRelationExport("csv") && (
                                <>
                                  <ContextMenuItem
                                    className={menuItemClass}
                                    onClick={() =>
                                      void runForSchema(schema, () =>
                                        exportTableData(table.name, "csv"),
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
                                        exportTableData(
                                          table.name,
                                          "csv",
                                          "utf8Bom",
                                        ),
                                      )
                                    }
                                  >
                                    <Download className="mr-2 h-3.5 w-3.5" />
                                    Export CSV (UTF-8 BOM)
                                  </ContextMenuItem>
                                </>
                              )}
                              {supportsRelationExport("json") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(table.name, "json"),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export JSON
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("jsonl") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(table.name, "jsonl"),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export JSON Lines
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("sql") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(table.name, "sql"),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export SQL Inserts
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("tsv") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(table.name, "tsv"),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export TSV
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("xlsx") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(
                                        table.name,
                                        "xlsx",
                                        "binary",
                                      ),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export Excel workbook (.xlsx)
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("parquet") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(
                                        table.name,
                                        "parquet",
                                        "binary",
                                      ),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export Apache Parquet (.parquet)
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("arrow") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(
                                        table.name,
                                        "arrow",
                                        "binary",
                                      ),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export Arrow IPC (.arrow)
                                </ContextMenuItem>
                              )}
                              {supportsRelationExport("markdown") && (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void runForSchema(schema, () =>
                                      exportTableData(table.name, "markdown"),
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-3.5 w-3.5" />
                                  Export Markdown table (.md)
                                </ContextMenuItem>
                              )}
                              {activeTableExport?.tableName === table.name && (
                                <ContextMenuItem
                                  className={cn(
                                    menuItemClass,
                                    "text-destructive",
                                  )}
                                  onClick={() => void cancelActiveTableExport()}
                                >
                                  <X className="mr-2 h-3.5 w-3.5" />
                                  Cancel active export
                                </ContextMenuItem>
                              )}
                            </ContextMenuSubContent>
                          </ContextMenuSub>
                          <ContextMenuItem
                            className={menuItemClass}
                            disabled={
                              isView ||
                              !objectConnection ||
                              !relationCapabilities.supportsTableDataTransfer
                            }
                            onClick={() => {
                              if (!objectConnection) return;
                              void handleOpenDataTransfer({
                                connection: objectConnection,
                                database: navigationDatabaseName,
                                schema,
                                table: table.name,
                                scope: "table",
                              });
                            }}
                          >
                            <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                            Transfer Table Data...
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={menuItemClass}
                            disabled={isView || !objectConnection}
                            onClick={() => {
                              if (!objectConnection) return;
                              void handleOpenDataCompare({
                                connection: objectConnection,
                                database: navigationDatabaseName,
                                schema,
                                table: table.name,
                              });
                            }}
                          >
                            <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                            Compare Table Data...
                          </ContextMenuItem>
                          <ContextMenuSeparator
                            className={menuSeparatorClass}
                          />
                          <ContextMenuItem
                            disabled={!relationCapabilities.supportsTableDdl}
                            onClick={() =>
                              void runForSchema(schema, () =>
                                handleDropClick(table),
                              )
                            }
                            className={cn(menuItemClass, "text-destructive")}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Drop {relationObjectLabel(table.type)}...
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
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
                          includeIndexes={
                            relationCapabilities.supportsTableIndexes
                          }
                          includeConstraints={
                            relationCapabilities.supportsTableConstraints
                          }
                          onReferenceSelect={({
                            schema: referencedSchema,
                            table: referencedTable,
                          }) =>
                            void handleTableDoubleClick(
                              { name: referencedTable },
                              referencedSchema,
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
        {renderRoutines()}
        {renderSchemaObjectDescriptors()}
        {renderVirtualViews()}
      </div>
    );
  };

  return (
    <div
      className="flex h-full min-w-0 flex-col"
      onKeyDownCapture={handleExplorerKeyDownCapture}
    >
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
          canCreateTable={Boolean(
            currentSchema &&
            canBrowseTables &&
            activeCapabilities.supportsTableDdl,
          )}
          canCreateView={Boolean(
            currentSchema && activeCapabilities.supportsViews,
          )}
          canManageAdministration={
            Boolean(activeConnectionId) &&
            supportsDatabaseAdministration(activeDriver)
          }
          isFilterVisible={isFilterVisible}
          onNewQueryConsole={handleNewQueryConsole}
          onNewDataSource={handleNewDataSource}
          onCreateNamespace={handleCreateDatabase}
          onCreateTable={handleCreateTable}
          onCreateView={handleCreateView}
          onRefresh={() => void handleRefresh()}
          onToggleFilter={() => setIsFilterVisible((visible) => !visible)}
          onManageAdministration={() =>
            setDatabaseAdministrationConnectionId(activeConnectionId)
          }
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
          {connections.length === 0 && connectionDisplayCache.length > 0 ? (
            <div className="space-y-0">
              {connectionDisplayCache.map((connection) => (
                <div
                  key={connection.id}
                  className="flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-[11px] text-[hsl(var(--wb-text-muted))]"
                  aria-label={connection.name}
                >
                  <ChevronRight size={13} className="shrink-0 wb-muted" />
                  <ConnectionGlyph
                    driver={connection.driver}
                    icon={connection.icon}
                    size={14}
                    className="shrink-0"
                    style={{
                      color: connectionTreeColor(
                        connection.driver,
                        connection.color,
                      ),
                    }}
                  />
                  <span className="truncate font-normal [font-variation-settings:'wght'_480]">
                    {connection.name}
                  </span>
                </div>
              ))}
              {connectionLoadError && (
                <div
                  className="mt-1 flex items-start gap-1.5 px-2 py-1.5 text-[10px] text-amber-500"
                  role="status"
                >
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={connectionLoadError}
                  >
                    Showing cached data sources; refresh failed.
                  </span>
                  <button
                    type="button"
                    className="shrink-0 underline underline-offset-2"
                    onClick={() => void loadConnections()}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          ) : connections.length === 0 &&
            connectionsLoading &&
            !hasConnectionDisplayCache ? (
            <div
              className="flex items-center gap-2 px-3 py-2.5 text-[11px] wb-muted"
              role="status"
              aria-label="Loading data sources"
            >
              <RefreshCw size={11} className="shrink-0 animate-spin" />
              <span>Loading data sources…</span>
            </div>
          ) : connections.length === 0 && connectionLoadError ? (
            <div
              className="flex items-start gap-2 px-3 py-3 text-[11px] text-amber-500"
              role="alert"
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div>
                  {hasConnectionDisplayCache
                    ? "No cached data sources; refresh failed."
                    : "Could not load data sources."}
                </div>
                <div
                  className="mt-0.5 truncate text-[10px] wb-muted"
                  title={connectionLoadError}
                >
                  {connectionLoadError}
                </div>
                <button
                  type="button"
                  className="mt-1.5 text-[10px] underline underline-offset-2"
                  onClick={() => void loadConnections()}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : connections.length === 0 ? (
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
              const isManagedConnection = connection.origin === "managed";
              const connectionColor = connectionTreeColor(
                connection.driver,
                connection.color,
              );
              const isActive = connection.id === activeConnectionId;
              const isConnecting = connectingConnectionIds.includes(
                connection.id,
              );
              const connectionRuntime = connectionRuntimeStates[connection.id];
              const connectionMetadata = metadataForConnection(
                connection.id,
                connection.driver,
              );
              const connectionSchemas = isActive
                ? schemaRows
                : connectionMetadata.schemas;
              const isConnectionExpanded = expandedConnectionIds.includes(
                connection.id,
              );
              const isFlatKeyValueTree =
                defaultDatabaseCapabilities(connection.driver).dataModel ===
                "keyValue";
              const connectionCanBrowseDatabaseCatalogs =
                supportsDatabaseCatalogTree(connection.driver);
              const connectedPostgresDatabase =
                connectionCanBrowseDatabaseCatalogs
                  ? connectionCatalogDatabaseName(connection)
                  : "";
              const normalizedObjectFilter = filterText
                .trim()
                .toLocaleLowerCase();
              const renderedConnectionSchemas =
                isActive &&
                connectionCanBrowseDatabaseCatalogs &&
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
                        schema,
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
                  data-database-connection-id={connection.id}
                  className="rounded-[3px] border border-transparent transition-colors"
                  style={connectionRegionStyle(connection.color, isActive)}
                >
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <div
                        role="button"
                        tabIndex={0}
                        className={cn(
                          "wb-tree-row flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] transition-colors",
                          isActive
                            ? "wb-tree-row-selected"
                            : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
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
                          <ChevronDown
                            size={13}
                            className="wb-tree-chevron shrink-0 wb-muted"
                          />
                        ) : (
                          <ChevronRight
                            size={13}
                            className="wb-tree-chevron shrink-0 wb-muted"
                          />
                        )}
                        <ConnectionGlyph
                          driver={connection.driver}
                          icon={connection.icon}
                          size={14}
                          className="shrink-0"
                          style={{ color: connectionColor }}
                          title={
                            showExplorerHoverTooltips
                              ? isManagedConnection
                                ? `${databaseDriverProfile(connection.driver).capabilities.displayName} through managed Gateway`
                                : `${databaseDriverProfile(connection.driver).capabilities.displayName} data source`
                              : undefined
                          }
                        />
                        <ConnectionRuntimeBadge
                          runtime={connectionRuntime}
                          isConnected={connectedConnectionIds.includes(
                            connection.id,
                          )}
                          isConnecting={isConnecting}
                        />
                        <span className="min-w-0 truncate font-normal [font-variation-settings:'wght'_480]">
                          {connection.name}
                        </span>
                        {databaseExplorerSettings.showConnectionNotes &&
                          connection.note?.trim() && (
                            <span
                              className="ml-auto max-w-[42%] truncate text-[9px] font-normal text-[hsl(var(--wb-text-muted))]"
                              title={
                                showExplorerHoverTooltips
                                  ? connection.note.trim()
                                  : undefined
                              }
                            >
                              {connection.note.trim()}
                            </span>
                          )}
                        {isManagedConnection && (
                          <span
                            className="inline-flex h-4 shrink-0 items-center gap-1 rounded-[3px] border border-[hsl(var(--wb-accent)/0.35)] bg-[hsl(var(--wb-accent)/0.08)] px-1 text-[8px] font-medium uppercase tracking-wide text-[hsl(var(--wb-accent))]"
                            title="Credentials stay behind the enterprise Gateway; local write surfaces are disabled."
                          >
                            <ShieldCheck size={9} />
                            Managed
                          </span>
                        )}
                        <MetadataNodeBadge
                          state={connectionMetadata.nodeState}
                        />
                        {isActive &&
                          isFlatKeyValueTree &&
                          (isLoading || isCollectionsLoading) && (
                            <RefreshCw
                              size={11}
                              className="ml-auto shrink-0 animate-spin wb-muted"
                              aria-label="Loading Redis keys"
                            />
                          )}
                        {isActive ? renderSchemaVisibilityPicker() : null}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className={menuContentClass}>
                      <ContextMenuSub>
                        <ContextMenuSubTrigger
                          className={menuSubClass}
                          disabled={isManagedConnection}
                        >
                          <Plus className="mr-2 h-3.5 w-3.5" />
                          New
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className={menuContentClass}>
                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={handleCreateDatabase}
                            disabled={
                              isManagedConnection ||
                              !activeCapabilities.supportsCreateDatabase
                            }
                          >
                            {namespaceLabel}
                          </ContextMenuItem>
                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={handleCreateTable}
                            disabled={
                              isManagedConnection ||
                              !isActive ||
                              !currentSchema ||
                              !canBrowseTables ||
                              !activeCapabilities.supportsTableDdl
                            }
                          >
                            Table
                          </ContextMenuItem>
                          {isFlatKeyValueTree &&
                            connection.driver === "redis" && (
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() => {
                                  if (!isActive) {
                                    void setActiveConnection(
                                      connection.id,
                                    ).then((error) => {
                                      if (!error) setIsCreateRedisKeyOpen(true);
                                    });
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
                      <ContextMenuItem
                        className={menuItemClass}
                        disabled={
                          !defaultDatabaseCapabilities(connection.driver)
                            .supportsSqlQuery ||
                          !defaultDatabaseCapabilities(connection.driver)
                            .supportsTableBrowsing
                        }
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent(APP_EVENT_OPEN_DATABASE_SEARCH, {
                              detail: {
                                connectionId: connection.id,
                                database: connectionCanBrowseDatabaseCatalogs
                                  ? connectedPostgresDatabase
                                  : undefined,
                              },
                            }),
                          )
                        }
                      >
                        <Search className="mr-2 h-3.5 w-3.5" />
                        Search Current Database...
                      </ContextMenuItem>
                      <ContextMenuItem
                        className={menuItemClass}
                        disabled={
                          !defaultDatabaseCapabilities(connection.driver)
                            .supportsTableBrowsing ||
                          defaultDatabaseCapabilities(connection.driver)
                            .dataModel !== "relational"
                        }
                        onClick={() =>
                          openDatabaseBrowser(connection.id, connection.name)
                        }
                      >
                        <Database className="mr-2 h-3.5 w-3.5" />
                        Browse Databases
                      </ContextMenuItem>
                      {normalizeDatabaseDriverName(connection.driver) ===
                        "rocketmq" && (
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            openRocketMqWorkspace(
                              connection.id,
                              connection.name,
                            )
                          }
                        >
                          <Network className="mr-2 h-3.5 w-3.5" />
                          Open RocketMQ Console
                        </ContextMenuItem>
                      )}
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
                            connection.name,
                          )
                        }
                      >
                        Forget Cached Metadata
                      </ContextMenuItem>
                      {!isManagedConnection && (
                        <ContextMenuItem
                          className={menuItemClass}
                          onClick={() =>
                            handleOpenConnectionProperties(connection.id)
                          }
                        >
                          Properties...
                        </ContextMenuItem>
                      )}
                      {!isManagedConnection &&
                        supportsDatabaseAdministration(connection.driver) && (
                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={() => {
                              setDatabaseAdministrationConnectionId(
                                connection.id,
                              );
                            }}
                          >
                            Database Administration...
                          </ContextMenuItem>
                        )}
                      <ContextMenuSub>
                        <ContextMenuSubTrigger
                          className={menuSubClass}
                          disabled={
                            isManagedConnection ||
                            !defaultDatabaseCapabilities(connection.driver)
                              .supportsSqlQuery
                          }
                        >
                          Import/Export
                        </ContextMenuSubTrigger>
                        <ContextMenuSubContent className={menuContentClass}>
                          {normalizeDatabaseDriverName(connection.driver) ===
                            "sqlite" && (
                            <>
                              <ContextMenuItem
                                className={menuItemClass}
                                disabled={!isActive || isManagedConnection}
                                onClick={() =>
                                  setSqliteBackupTarget({
                                    connectionId: connection.id,
                                    connectionName: connection.name,
                                    initialOperation: "backup",
                                  })
                                }
                              >
                                <Download className="mr-2 h-3.5 w-3.5" />
                                Back up SQLite database...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                disabled={!isActive || isManagedConnection}
                                onClick={() =>
                                  setSqliteBackupTarget({
                                    connectionId: connection.id,
                                    connectionName: connection.name,
                                    initialOperation: "restore",
                                  })
                                }
                              >
                                <ArchiveRestore className="mr-2 h-3.5 w-3.5" />
                                Restore SQLite database...
                              </ContextMenuItem>
                              <ContextMenuSeparator
                                className={menuSeparatorClass}
                              />
                            </>
                          )}
                          <ContextMenuItem
                            className={menuItemClass}
                            onClick={() =>
                              void handleImportSqlScript({
                                connectionId: connection.id,
                                database: connectionCanBrowseDatabaseCatalogs
                                  ? connectedPostgresDatabase
                                  : undefined,
                              })
                            }
                          >
                            <Upload className="mr-2 h-3.5 w-3.5" />
                            Import SQL Script...
                          </ContextMenuItem>
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                      {!isManagedConnection && (
                        <>
                          <ContextMenuSeparator
                            className={menuSeparatorClass}
                          />
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
                        </>
                      )}
                    </ContextMenuContent>
                  </ContextMenu>

                  {isConnectionExpanded ? (
                    <div className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pb-1 pl-2 pr-1">
                      <PostgresDatabaseTree
                        connectionId={connection.id}
                        key={`${connection.id}:${
                          connectionCanBrowseDatabaseCatalogs
                            ? postgresDatabaseRefreshVersion
                            : 0
                        }:${isActive ? "active" : "inactive"}`}
                        enabled={
                          isActive && connectionCanBrowseDatabaseCatalogs
                        }
                        databases={
                          postgresDatabaseDiscovery.connectionId ===
                          connection.id
                            ? postgresDatabaseDiscovery.databases
                            : []
                        }
                        currentDatabase={connectedPostgresDatabase}
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
                          isActive && connectionCanBrowseDatabaseCatalogs
                            ? visiblePostgresDatabases
                            : undefined
                        }
                        filterText={
                          connectionCanBrowseDatabaseCatalogs ? filterText : ""
                        }
                        databaseMatchesFilter={(database, normalizedFilter) =>
                          postgresDatabaseMatchesFilter(
                            connection.id,
                            database,
                            connectedPostgresDatabase,
                            normalizedFilter,
                          )
                        }
                        onLoadDatabase={
                          isActive && connectionCanBrowseDatabaseCatalogs
                            ? async (database) => {
                                if (
                                  !useConnectionStore
                                    .getState()
                                    .connectedConnectionIds.includes(
                                      connection.id,
                                    )
                                ) {
                                  const connectionError =
                                    await setActiveConnection(connection.id);
                                  if (connectionError) {
                                    throw new Error(connectionError);
                                  }
                                }
                                await loadPostgresRemoteDatabase(
                                  connection.id,
                                  database,
                                );
                              }
                            : undefined
                        }
                        renderDatabaseContextMenu={(database) => {
                          const databaseSchemas =
                            postgresRemoteDatabases.connectionId ===
                            connection.id
                              ? postgresRemoteDatabases.schemas[database] || []
                              : [];

                          return (
                            <>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  window.dispatchEvent(
                                    new CustomEvent(
                                      APP_EVENT_OPEN_DATABASE_SEARCH,
                                      {
                                        detail: {
                                          connectionId: connection.id,
                                          database,
                                        },
                                      },
                                    ),
                                  )
                                }
                              >
                                <Search className="mr-2 h-3.5 w-3.5" />
                                Search Database Rows...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() => void copyText(database)}
                              >
                                Copy Name
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void handleImportSqlScript({
                                    connectionId: connection.id,
                                    database,
                                  })
                                }
                              >
                                <Upload className="mr-2 h-3.5 w-3.5" />
                                Import SQL Script...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void handleOpenDataTransfer({
                                    connection,
                                    database,
                                    scope: "database",
                                  })
                                }
                              >
                                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                                Transfer Database Data...
                              </ContextMenuItem>
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void handleOpenDataCompare({
                                    connection,
                                    database,
                                  })
                                }
                              >
                                <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                                Compare Database Tables...
                              </ContextMenuItem>
                              {databaseSchemas.length > 0 ? (
                                <ContextMenuSub>
                                  <ContextMenuSubTrigger
                                    className={menuItemClass}
                                  >
                                    <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                                    Schema Snapshots / Diff
                                  </ContextMenuSubTrigger>
                                  <ContextMenuSubContent className="min-w-[190px]">
                                    {databaseSchemas.map((schema) => (
                                      <ContextMenuItem
                                        key={schema}
                                        className={menuItemClass}
                                        onClick={() => {
                                          setSchemaSnapshotIdentity({
                                            projectId: activeProjectId,
                                            connectionId: connection.id,
                                            connectionName: connection.name,
                                            driver: connection.driver,
                                            databaseName: database,
                                            schemaName: schema,
                                          });
                                        }}
                                      >
                                        {schema}
                                      </ContextMenuItem>
                                    ))}
                                  </ContextMenuSubContent>
                                </ContextMenuSub>
                              ) : (
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    void loadPostgresRemoteDatabase(
                                      connection.id,
                                      database,
                                    )
                                  }
                                >
                                  <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                                  Load schemas for migration...
                                </ContextMenuItem>
                              )}
                              <ContextMenuSeparator
                                className={menuSeparatorClass}
                              />
                              <ContextMenuItem
                                className={menuItemClass}
                                onClick={() =>
                                  void (database === connectedPostgresDatabase
                                    ? handleRefreshConnection(connection.id)
                                    : loadPostgresRemoteDatabase(
                                        connection.id,
                                        database,
                                      ))
                                }
                              >
                                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                Refresh Selected
                              </ContextMenuItem>
                            </>
                          );
                        }}
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
                              refreshRequest={
                                postgresRemoteRefreshRequest?.connectionId ===
                                  connection.id &&
                                postgresRemoteRefreshRequest.database ===
                                  database
                                  ? postgresRemoteRefreshRequest
                                  : undefined
                              }
                              filterText={
                                database
                                  .toLocaleLowerCase()
                                  .includes(
                                    filterText.trim().toLocaleLowerCase(),
                                  )
                                  ? ""
                                  : filterText
                              }
                              onTablesLoaded={(schema, databaseTables) =>
                                handlePostgresRemoteTablesLoaded(
                                  connection.id,
                                  database,
                                  schema,
                                  databaseTables,
                                )
                              }
                              onOpenSchemaSnapshots={(databaseName, schema) => {
                                setSchemaSnapshotIdentity({
                                  projectId: activeProjectId,
                                  connectionId: connection.id,
                                  connectionName: connection.name,
                                  driver: connection.driver,
                                  databaseName,
                                  schemaName: schema,
                                });
                              }}
                              onOpenSchemaDataTransfer={(
                                databaseName,
                                schema,
                              ) =>
                                void handleOpenDataTransfer({
                                  connection,
                                  database: databaseName,
                                  schema,
                                  scope: "schema",
                                })
                              }
                              activationMode={explorerActivationMode}
                              onOpenSchemaDataCompare={(databaseName, schema) =>
                                void handleOpenDataCompare({
                                  connection,
                                  database: databaseName,
                                  schema,
                                })
                              }
                              onOpenTableSchemaSnapshots={(
                                databaseName,
                                schema,
                                table,
                              ) => {
                                setSchemaSnapshotIdentity({
                                  projectId: activeProjectId,
                                  connectionId: connection.id,
                                  connectionName: connection.name,
                                  driver: connection.driver,
                                  databaseName,
                                  schemaName: schema,
                                  tableName: table,
                                });
                              }}
                              onOpenTableDataTransfer={(
                                databaseName,
                                schema,
                                table,
                              ) =>
                                void handleOpenDataTransfer({
                                  connection,
                                  database: databaseName,
                                  schema,
                                  table,
                                  scope: "table",
                                })
                              }
                              onOpenTableDataCompare={(
                                databaseName,
                                schema,
                                table,
                              ) =>
                                void handleOpenDataCompare({
                                  connection,
                                  database: databaseName,
                                  schema,
                                  table,
                                })
                              }
                              onOpenTableMaintenance={
                                connection.driverPackageVersion
                                  ? undefined
                                  : (databaseName, schema, table) =>
                                      setDatabaseMaintenanceTarget({
                                        connectionId: connection.id,
                                        connectionName: connection.name,
                                        driver: connection.driver,
                                        database: databaseName,
                                        schema,
                                        table,
                                      })
                              }
                              onImportSqlScript={(databaseName, schema) =>
                                void handleImportSqlScript({
                                  connectionId: connection.id,
                                  database: databaseName,
                                  schema,
                                })
                              }
                              onOpenTable={(databaseName, schema, table) =>
                                handlePostgresRemoteTableOpen(
                                  connection.id,
                                  databaseName,
                                  schema,
                                  table,
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
                            const isLoginSchema = isLoginUserSchema(
                              connection,
                              schema,
                            );
                            const schemaKey = schemaTreeKey(
                              connection.id,
                              connection.driver,
                              schema,
                            );
                            const isSchemaExpanded =
                              expandedSchemaKeys.includes(schemaKey);
                            const schemaNodeState =
                              metadataNodeStates[
                                getSchemaMetadataNodeKey(
                                  connection.id,
                                  connection.driver,
                                  schema,
                                )
                              ];

                            return (
                              <div key={schema} className="min-w-0">
                                <ContextMenu>
                                  <ContextMenuTrigger asChild>
                                    <button
                                      type="button"
                                      aria-expanded={isSchemaExpanded}
                                      data-database-schema-key={databaseSchemaNavigationKey(
                                        {
                                          connectionId: connection.id,
                                          databaseName:
                                            connectionCanBrowseDatabaseCatalogs
                                              ? connectionCatalogDatabaseName(
                                                  connection,
                                                )
                                              : connection.database ||
                                                undefined,
                                          schemaName: schema,
                                        },
                                      )}
                                      className={cn(
                                        "wb-tree-row flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] font-normal [font-variation-settings:'wght'_430] transition-colors",
                                        isLoginSchema &&
                                          "font-semibold [font-variation-settings:'wght'_600]",
                                        isCurrentSchema
                                          ? "wb-tree-row-selected font-medium text-[hsl(var(--wb-text))]"
                                          : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                                      )}
                                      title={
                                        isLoginSchema
                                          ? `${schema} · current login user`
                                          : schema
                                      }
                                      onClick={() => {
                                        void handleSchemaRowClick(
                                          connection.id,
                                          schema,
                                          isCurrentSchema,
                                        ).catch((error) => {
                                          console.warn(
                                            "Failed to toggle schema",
                                            error,
                                          );
                                        });
                                      }}
                                    >
                                      {isSchemaExpanded ? (
                                        <ChevronDown
                                          size={12}
                                          className="wb-tree-chevron shrink-0 wb-muted"
                                        />
                                      ) : (
                                        <ChevronRight
                                          size={12}
                                          className="wb-tree-chevron shrink-0 wb-muted"
                                        />
                                      )}
                                      {isFlatKeyValueTree ? (
                                        <Database
                                          size={12}
                                          className="shrink-0"
                                          style={{ color: connectionColor }}
                                        />
                                      ) : (
                                        <Network
                                          size={12}
                                          className={cn(
                                            "shrink-0",
                                            explorerObjectIconClass("schema"),
                                          )}
                                        />
                                      )}
                                      <span className="truncate">
                                        {isFlatKeyValueTree
                                          ? `db ${schema}`
                                          : schema}
                                      </span>
                                      <MetadataNodeBadge
                                        state={schemaNodeState}
                                      />
                                    </button>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent
                                    className={menuContentClass}
                                  >
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
                                                schema,
                                              );
                                            }
                                          }}
                                          disabled={
                                            !activeConnectionId ||
                                            !canBrowseTables ||
                                            !activeCapabilities.supportsTableDdl
                                          }
                                        >
                                          Table
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          className={menuItemClass}
                                          onClick={() =>
                                            void runForSchema(
                                              schema,
                                              handleCreateView,
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
                                          schema,
                                        )
                                      }
                                      disabled={
                                        isLoading || isCollectionsLoading
                                      }
                                    >
                                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                      Refresh Selected
                                      <ContextMenuShortcut>
                                        ⌘R
                                      </ContextMenuShortcut>
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className={menuItemClass}
                                      onClick={() =>
                                        void handleForgetSchemaMetadata(
                                          connection.id,
                                          connection.driver,
                                          schema,
                                        )
                                      }
                                    >
                                      Forget Cached Metadata
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className={menuItemClass}
                                      disabled={
                                        Boolean(schemaDiagramLoadingKey) ||
                                        !(
                                          supportsTableWorkspace(
                                            defaultDatabaseCapabilities(
                                              connection.driver,
                                            ),
                                          ) ||
                                          defaultDatabaseCapabilities(
                                            connection.driver,
                                          ).supportsCollectionBrowsing
                                        )
                                      }
                                      onClick={() =>
                                        void handleOpenSchemaDiagram({
                                          projectId: activeProjectId,
                                          connectionId: connection.id,
                                          connectionName: connection.name,
                                          driver: connection.driver,
                                          databaseName:
                                            connectionCanBrowseDatabaseCatalogs
                                              ? connectedPostgresDatabase
                                              : undefined,
                                          schemaName: schema,
                                        })
                                      }
                                    >
                                      <Network className="mr-2 h-3.5 w-3.5" />
                                      Open Schema Diagram
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className={menuItemClass}
                                      disabled={
                                        !defaultDatabaseCapabilities(
                                          connection.driver,
                                        ).supportsSqlQuery ||
                                        !defaultDatabaseCapabilities(
                                          connection.driver,
                                        ).supportsTableBrowsing
                                      }
                                      onClick={() =>
                                        window.dispatchEvent(
                                          new CustomEvent(
                                            APP_EVENT_OPEN_DATABASE_SEARCH,
                                            {
                                              detail: {
                                                connectionId: connection.id,
                                                database:
                                                  connectionCanBrowseDatabaseCatalogs
                                                    ? connectedPostgresDatabase
                                                    : undefined,
                                                schema,
                                              },
                                            },
                                          ),
                                        )
                                      }
                                    >
                                      <Search className="mr-2 h-3.5 w-3.5" />
                                      Search Schema Rows...
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className={menuItemClass}
                                      onClick={() =>
                                        void handleOpenDataTransfer({
                                          connection,
                                          database:
                                            connectionCanBrowseDatabaseCatalogs
                                              ? connectedPostgresDatabase
                                              : undefined,
                                          schema,
                                          scope: "schema",
                                        })
                                      }
                                    >
                                      <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                                      Transfer Schema Data...
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className={menuItemClass}
                                      onClick={() =>
                                        void handleOpenDataCompare({
                                          connection,
                                          database:
                                            connectionCanBrowseDatabaseCatalogs
                                              ? connectedPostgresDatabase
                                              : undefined,
                                          schema,
                                        })
                                      }
                                    >
                                      <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                                      Compare Schema Data...
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      className={menuItemClass}
                                      disabled={
                                        !(
                                          supportsTableWorkspace(
                                            defaultDatabaseCapabilities(
                                              connection.driver,
                                            ),
                                          ) ||
                                          defaultDatabaseCapabilities(
                                            connection.driver,
                                          ).supportsCollectionBrowsing
                                        )
                                      }
                                      onClick={() => {
                                        void setActiveConnection(
                                          connection.id,
                                        ).then((connectionError) => {
                                          if (connectionError) {
                                            setNamespaceError(connectionError);
                                            return;
                                          }
                                          setSchemaSnapshotIdentity({
                                            projectId: activeProjectId,
                                            connectionId: connection.id,
                                            connectionName: connection.name,
                                            driver: connection.driver,
                                            databaseName:
                                              connectionCanBrowseDatabaseCatalogs
                                                ? connectedPostgresDatabase
                                                : undefined,
                                            schemaName: schema,
                                          });
                                        });
                                      }}
                                    >
                                      <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                                      {supportsTableWorkspace(
                                        defaultDatabaseCapabilities(
                                          connection.driver,
                                        ),
                                      )
                                        ? "Schema Snapshots / Diff..."
                                        : "Metadata Snapshots..."}
                                    </ContextMenuItem>
                                    <ContextMenuSub>
                                      <ContextMenuSubTrigger
                                        className={menuSubClass}
                                        disabled={
                                          !defaultDatabaseCapabilities(
                                            connection.driver,
                                          ).supportsSqlQuery
                                        }
                                      >
                                        Import/Export
                                      </ContextMenuSubTrigger>
                                      <ContextMenuSubContent
                                        className={menuContentClass}
                                      >
                                        <ContextMenuItem
                                          className={menuItemClass}
                                          onClick={() =>
                                            void handleImportSqlScript({
                                              connectionId: connection.id,
                                              schema,
                                              database:
                                                connection.driver === "postgres"
                                                  ? connectedPostgresDatabase
                                                  : undefined,
                                            })
                                          }
                                        >
                                          <Upload className="mr-2 h-3.5 w-3.5" />
                                          Import SQL Script...
                                        </ContextMenuItem>
                                      </ContextMenuSubContent>
                                    </ContextMenuSub>
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
                                      <ContextMenuShortcut>
                                        ⇧F6
                                      </ContextMenuShortcut>
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
                                        <ContextMenuItem
                                          className={menuItemClass}
                                        >
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
                                        "text-destructive",
                                      )}
                                      onClick={() =>
                                        void handleDropDatabase(schema)
                                      }
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
                                    connectionColor,
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

      <SqlScriptImportDialog
        open={Boolean(pendingSqlScriptImport)}
        preview={pendingSqlScriptImport?.preview || null}
        target={pendingSqlScriptImport?.target.label || "selected data source"}
        isSubmitting={isSqlScriptImporting}
        onClose={closeSqlScriptImport}
        onImport={handleConfirmSqlScriptImport}
      />

      <Suspense fallback={null}>
        {isDataSourceDialogOpen && (
          <DataSourceDialog open onOpenChange={setIsDataSourceDialogOpen} />
        )}
        {schemaSnapshotIdentity !== null && (
          <SchemaSnapshotDialog
            open
            identity={schemaSnapshotIdentity}
            onClose={() => setSchemaSnapshotIdentity(null)}
          />
        )}
        {dataTransferRequest !== null && (
          <TableDataTransferDialog
            open
            projectId={activeProjectId}
            source={dataTransferRequest.source}
            initialSourceScope={dataTransferRequest.initialSourceScope}
            initialSourceTables={dataTransferRequest.initialSourceTables}
            initialTarget={dataTransferRequest.initialTarget}
            sourceSchemas={dataTransferRequest.sourceSchemas}
            sourceCapabilities={dataTransferRequest.sourceCapabilities}
            connections={connections}
            onClose={() => setDataTransferRequest(null)}
            onTransferred={() => {
              const { connectionId, schema } = dataTransferRequest.source;
              void handleRefreshSchema(connectionId, schema);
            }}
          />
        )}
        {mongoCollectionTransferRequest !== null && (
          <MongoCollectionTransferDialog
            open
            sourceConnectionId={mongoCollectionTransferRequest.sourceConnectionId}
            sourceConnectionName={mongoCollectionTransferRequest.sourceConnectionName}
            sourceDatabase={mongoCollectionTransferRequest.sourceDatabase}
            sourceCollection={mongoCollectionTransferRequest.sourceCollection}
            connections={connections}
            onClose={() => setMongoCollectionTransferRequest(null)}
            onTransferred={(targetConnectionId) => {
              if (targetConnectionId === activeConnectionId) {
                void refreshCollectionObjects();
              }
            }}
          />
        )}
        {dataCompareRequest !== null && (
          <TableDataCompareDialog
            open
            source={dataCompareRequest.source}
            sourceTables={dataCompareRequest.sourceTables}
            connections={connections}
            onClose={() => setDataCompareRequest(null)}
            onTransferMissing={(tables, target) => {
              setDataTransferRequest({
                source: dataCompareRequest.source,
                sourceCapabilities: dataCompareRequest.sourceCapabilities,
                initialSourceScope: tables.length > 1 ? "schema" : "table",
                sourceSchemas: [dataCompareRequest.source.schema],
                initialSourceTables: tables,
                initialTarget: target,
              });
              setDataCompareRequest(null);
            }}
          />
        )}
        {nacosConfigTransferRequest !== null && (
          <NacosConfigTransferDialog
            open
            sourceConnectionId={nacosConfigTransferRequest.sourceConnectionId}
            sourceConnectionName={
              nacosConfigTransferRequest.sourceConnectionName
            }
            source={nacosConfigTransferRequest.source}
            connections={connections}
            onClose={() => setNacosConfigTransferRequest(null)}
            onTransferred={(targetConnectionId) => {
              if (targetConnectionId === activeConnectionId) {
                void refreshCollectionObjects();
              }
            }}
          />
        )}
        {elasticsearchMetadataTarget !== null && (
          <ElasticsearchIndexMetadataDialog
            open
            connectionId={elasticsearchMetadataTarget.connectionId}
            driver={elasticsearchMetadataTarget.driver}
            index={elasticsearchMetadataTarget.index}
            initialKind={elasticsearchMetadataTarget.kind}
            onClose={() => setElasticsearchMetadataTarget(null)}
          />
        )}
        {elasticsearchClearTarget !== null && (
          <ElasticsearchIndexClearDialog
            open
            connectionId={elasticsearchClearTarget.connectionId}
            driver={elasticsearchClearTarget.driver}
            index={elasticsearchClearTarget.index}
            onClose={() => setElasticsearchClearTarget(null)}
            onCleared={(result, index) =>
              void handleElasticsearchIndexCleared(result, index)
            }
          />
        )}
      </Suspense>
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
            <DialogTitle className="text-[15px]">
              Remove data source?
            </DialogTitle>
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
      <Suspense fallback={null}>
        {databaseAdministrationConnectionId && (
          <DatabaseAdministrationDialog
            open
            onOpenChange={(open) => {
              if (!open) setDatabaseAdministrationConnectionId(null);
            }}
            connectionId={databaseAdministrationConnectionId}
            driver={
              connections.find(
                (connection) =>
                  connection.id === databaseAdministrationConnectionId,
              )?.driver || activeDriver
            }
            connectionName={
              connections.find(
                (connection) =>
                  connection.id === databaseAdministrationConnectionId,
              )?.name
            }
          />
        )}
        {databaseMaintenanceTarget && (
          <DatabaseMaintenanceDialog
            key={[
              databaseMaintenanceTarget.connectionId,
              databaseMaintenanceTarget.database,
              databaseMaintenanceTarget.schema,
              databaseMaintenanceTarget.table,
            ].join(":")}
            open
            target={databaseMaintenanceTarget}
            onOpenChange={(open) => {
              if (!open) setDatabaseMaintenanceTarget(null);
            }}
          />
        )}
        {sqliteBackupTarget && (
          <SqliteBackupDialog
            key={`${sqliteBackupTarget.connectionId}:${sqliteBackupTarget.initialOperation || "backup"}`}
            open
            target={sqliteBackupTarget}
            onOpenChange={(open) => {
              if (!open) setSqliteBackupTarget(null);
            }}
            onCompleted={() =>
              handleRefreshConnection(sqliteBackupTarget.connectionId)
            }
          />
        )}
        {isCreateDbDialogOpen && (
          <CreateDatabaseDialog
            isOpen
            onClose={() => setIsCreateDbDialogOpen(false)}
            activeConnectionId={activeConnectionId || ""}
            onCreated={(schema) => {
              if (!activeConnectionId) return;
              if (activeDriver === "postgres") return;
              const schemaKey = schemaTreeKey(
                activeConnectionId,
                activeDriver,
                schema,
              );
              const objectsKey = objectGroupKey(
                activeConnectionId,
                activeDriver,
                schema,
                "objects",
              );
              setExpandedConnectionIds((current) =>
                current.includes(activeConnectionId)
                  ? current
                  : [...current, activeConnectionId],
              );
              setExpandedSchemaKeys((current) =>
                current.includes(schemaKey) ? current : [...current, schemaKey],
              );
              setExpandedObjectGroupKeys((current) =>
                current.includes(objectsKey)
                  ? current
                  : [...current, objectsKey],
              );
            }}
          />
        )}
        {renameDialogOpen && (
          <RenameTableDialog
            isOpen
            onClose={() => setRenameDialogOpen(false)}
            tableName={activeTable}
            objectLabel={relationObjectLabel(activeTableType)}
            onRename={(oldName, newName) =>
              renameTable(oldName, newName, activeTableType)
            }
          />
        )}
        {ddlViewerOpen && (
          <DdlViewerDialog
            isOpen
            onClose={() => setDdlViewerOpen(false)}
            tableName={activeTable}
            ddl={ddlContent}
          />
        )}
        {columnsDialogOpen && (
          <EditColumnsDialog
            isOpen
            onClose={() => setColumnsDialogOpen(false)}
            connectionId={activeConnectionId || ""}
            driver={activeDriver}
            schema={currentSchema || ""}
            tableName={activeTable}
          />
        )}
        {isCreateViewDialogOpen && (
          <CreateViewDialog
            isOpen
            onClose={() => setIsCreateViewDialogOpen(false)}
            connectionId={activeConnectionId || ""}
            driver={activeDriver}
            schema={currentSchema || ""}
            mode={viewDialogMode}
            viewKind={viewDialogKind}
            initialViewName={viewDialogInitialName}
            initialSelectSql={viewDialogInitialSql}
          />
        )}
        {isCreateRedisKeyOpen && (
          <RedisKeyDialog
            open
            database={collectionNamespace || "0"}
            onOpenChange={setIsCreateRedisKeyOpen}
            onCreate={(draft, command) =>
              handleCreateRedisKey(draft.name, command)
            }
          />
        )}
      </Suspense>
    </div>
  );
}
