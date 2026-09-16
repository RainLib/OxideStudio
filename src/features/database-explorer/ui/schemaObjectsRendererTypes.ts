import type { ConnectionConfig } from "@/features/connections/model/types";
import type { DatabaseMaintenanceTarget } from "@/features/database-admin/ui/DatabaseMaintenanceDialog";
import type {
  ExplorerMongoCollectionTransferRequest,
  ExplorerNacosConfigTransferRequest,
  ExplorerTableBatchSelection,
} from "@/features/database-explorer/model/explorerSidebarTypes";
import type { ExplorerVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import type { TableBatchFailureDetail } from "@/features/database-explorer/model/tableBatchSelection";
import type { useExplorerHistoryMenu } from "@/features/database-explorer/ui/useExplorerHistoryMenu";
import type { MetadataNodeState } from "@/features/schema-metadata/model/types";
import type {
  ExplorerActivationMode,
  TableTabReuseMode,
} from "@/features/settings/model/settingsTypes";
import type {
  TabData,
  TablePageLoadOptions,
  TabType,
} from "@/features/workspace-tabs/model/types";
import type { TableOperationTarget } from "@/hooks/useTableOperations";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type { TableMetadataSnapshot } from "@/services/tableMetadataCache";
import type {
  DatabaseDriver,
  DatabaseTableExportFormat,
} from "@/services/tauri/types/database";
import type { SearchIndexMetadataKind } from "@/services/tauri/types/elasticsearch";
import type {
  CollectionInfo,
  FunctionInfo,
  SchemaObjectInfo,
  TableInfo,
} from "@/services/tauri/types/schemaCatalog";
import type { TableExportEncoding } from "@/services/tauri/types/tableExport";
import type { TableImportFormat } from "@/services/tauri/types/tableImport";
import type { TableFilter } from "@/services/tauri/types/tableRows";
import type { JSX } from "react";
export interface CreateSchemaObjectsRendererContext {
  activeConnectionId: string | null;
  currentSchema: string | null;
  connections: ConnectionConfig[];
  runForExplorerSchema: (
    connectionId: string,
    schema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  setActiveConnection: (id: string) => Promise<string | null>;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  createTab: (
    type?: TabType | undefined,
    title?: string | undefined,
    initialSql?: string | undefined,
    metadata?:
      | Partial<
          Pick<
            TabData,
            | "connectionId"
            | "databaseName"
            | "tableName"
            | "schemaName"
            | "objectType"
            | "queryLanguage"
            | "elasticsearchVariables"
            | "filters"
            | "fileProjectId"
            | "savedSqlProjectId"
            | "savedSqlFileId"
            | "fileRootPath"
            | "fileRelativePath"
            | "fileRevision"
            | "filePreview"
            | "isDirty"
            | "targetSchema"
            | "agentFileDiffPreview"
            | "gitFileDiffPreview"
          >
        >
      | undefined,
  ) => string;
  schemaObjectsFor: (
    connectionId: string,
    driver: string | null | undefined,
    schema: string,
    databaseName?: string,
  ) => {
    tables: TableInfo[];
    collections: CollectionInfo[];
    functions: FunctionInfo[];
    pinnedTables: string[];
    hasSnapshot: boolean;
  };
  explorerVisibilityFilters: Record<string, ExplorerVisibilityFilter>;
  collectionTotal: number | null;
  expandedObjectGroupKeys: string[];
  tableBatchSelection: ExplorerTableBatchSelection | null;
  metadataNodeStates: Record<string, MetadataNodeState>;
  isLoading: boolean;
  setCurrentSchema: (schema: string) => Promise<void>;
  schemaObjectDescriptorScope: string | null;
  schemaObjectDescriptors: SchemaObjectInfo[];
  explorerFilterMatches: (...values: unknown[]) => boolean;
  setActiveTable: React.Dispatch<React.SetStateAction<string>>;
  setDdlContent: React.Dispatch<React.SetStateAction<string>>;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  collectionNextCursor: string | null;
  isCollectionsLoading: boolean;
  loadMoreCollections: (
    connectionId: string,
    namespace: string,
  ) => Promise<void>;
  selectedExplorerNodeIds: string[];
  copyText: (value: string) => Promise<void>;
  activeDriver: DatabaseDriver;
  activeProjectId: string;
  activeConnection: ConnectionConfig | undefined;
  hideExplorerNodes: (
    scopeId: string,
    parentNodeId: string,
    nodeIds: readonly string[],
  ) => void;
  explorerStateScope: string;
  showOnlyExplorerNodes: (
    scopeId: string,
    parentNodeId: string,
    nodeIds: readonly string[],
  ) => void;
  clearExplorerVisibilityFilter: (
    scopeId: string,
    parentNodeId: string,
  ) => void;
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
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
  showExplorerHoverTooltips: boolean;
  highlightMatch: (text: string, filter: string) => JSX.Element;
  filterText: string;
  isFunctionsLoading: boolean;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  explorerTreeRowHeight: 22 | 28;
  selectedTable: string | null;
  expandedTableKeys: string[];
  explorerActivationMode: ExplorerActivationMode;
  handleTableDoubleClick: (
    table: TableInfo,
    schemaName?: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  handleTableSelect: (tableName: string) => void;
  setExpandedTableKeys: React.Dispatch<React.SetStateAction<string[]>>;
  renderSqlHistorySubmenu: ReturnType<
    typeof useExplorerHistoryMenu
  >["renderSqlHistorySubmenu"];
  handleDdlClick: (
    table: TableInfo,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  handleEditViewClick: (
    table: TableInfo,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  handleRefreshMaterializedViewClick: (
    table: TableInfo,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  handleCopyTableDdl: (
    table: TableInfo,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  handleCreateView: () => void;
  handleCreateMaterializedView: () => void;
  setIsSchemaObjectDescriptorsLoading: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  setSchemaObjectDescriptors: React.Dispatch<
    React.SetStateAction<SchemaObjectInfo[]>
  >;
  setSchemaObjectDescriptorScope: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  expandedSchemaObjectMemberKeys: string[];
  schemaObjectMemberStates: Record<
    string,
    { loading: boolean; error: boolean; members: SchemaObjectInfo[] }
  >;
  setExpandedSchemaObjectMemberKeys: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  setSchemaObjectMemberStates: React.Dispatch<
    React.SetStateAction<
      Record<
        string,
        { loading: boolean; error: boolean; members: SchemaObjectInfo[] }
      >
    >
  >;
  isSchemaObjectDescriptorsLoading: boolean;
  collectionDeleteSql: (collection: CollectionInfo) => string | null;
  handleCollectionDoubleClick: (collection: CollectionInfo) => void;
  handleCollectionSelect: (collectionName: string) => void;
  collectionPreviewSql: (collection: CollectionInfo) => string;
  handleCopyCollectionPreview: (collection: CollectionInfo) => Promise<void>;
  setElasticsearchMetadataTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      index: string;
      kind: SearchIndexMetadataKind;
    } | null>
  >;
  setNacosConfigTransferRequest: React.Dispatch<
    React.SetStateAction<ExplorerNacosConfigTransferRequest | null>
  >;
  setMongoCollectionTransferRequest: React.Dispatch<
    React.SetStateAction<ExplorerMongoCollectionTransferRequest | null>
  >;
  setElasticsearchClearTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      schema: string;
      index: string;
    } | null>
  >;
  handleDeleteCollectionClick: (collection: CollectionInfo) => void;
  suppressTableReferenceClickRef: React.RefObject<boolean>;
  tableBatchAction: {
    scopeKey: string;
    running: boolean;
    message: string;
    cancelId?: string | undefined;
    failures?: TableBatchFailureDetail[] | undefined;
    omittedFailures?: number | undefined;
  } | null;
  setTableBatchSelection: React.Dispatch<
    React.SetStateAction<ExplorerTableBatchSelection | null>
  >;
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
  togglePinTable: (tableName: string) => void;
  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    objectType?: string | null | undefined,
    databaseName?: string | undefined,
    options?: { reuseMode?: TableTabReuseMode | undefined } | undefined,
  ) => string;
  loadTablePage: (
    tabId: string,
    page?: number | undefined,
    filterSql?: string | null | undefined,
    filters?: TableFilter[] | null | undefined,
    options?: TablePageLoadOptions | undefined,
  ) => Promise<boolean>;
  setSchemaSnapshotIdentity: React.Dispatch<
    React.SetStateAction<SchemaSnapshotIdentity | null>
  >;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean | undefined,
    filter?: string | undefined,
    revalidateCached?: boolean | undefined,
  ) => Promise<void>;
  setTableMetadata: (tabId: string, metadata: TableMetadataSnapshot) => void;
  handleRenameClick: (table: TableInfo) => void;
  handleEditColumnsClick: (table: TableInfo) => void;
  handleTruncateClick: (
    table: TableInfo,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  setDatabaseMaintenanceTarget: React.Dispatch<
    React.SetStateAction<DatabaseMaintenanceTarget | null>
  >;
  handleTableCsvImport: (
    table: TableInfo,
    schemaName: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  importTableData: (
    tableName: string,
    format: TableImportFormat,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  handleTableJsonImport: (
    table: TableInfo,
    schemaName: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  handleTableXlsxImport: (
    table: TableInfo,
    schemaName: string,
    targetConnectionId?: string,
    databaseName?: string | undefined,
  ) => Promise<void>;
  handleImportSqlScript: ({
    connectionId,
    schema,
    database,
  }: {
    connectionId: string;
    schema?: string | undefined;
    database?: string | undefined;
  }) => void;
  exportTableData: (
    tableName: string,
    format?: DatabaseTableExportFormat,
    encoding?: TableExportEncoding,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  activeTableExport: {
    exportId: string;
    taskId: string;
    tableName: string;
  } | null;
  cancelActiveTableExport: () => Promise<void>;
  handleOpenDataTransfer: (options: {
    connection: ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
    scope: "table" | "database" | "schema";
  }) => Promise<void>;
  handleOpenDataCompare: (options: {
    connection: ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
  }) => Promise<void>;
  handleDropClick: (
    table: TableInfo,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  setIsTablesHovered: React.Dispatch<React.SetStateAction<boolean>>;
  isTablesHovered: boolean;
  renderObjectActions: () => JSX.Element | null;
  createTableTab: (connectionId: string, schemaName: string) => string;
  handleCreateCollectionClick: () => void;
  openObjectBrowser: (
    connectionId: string,
    connectionName: string,
    databaseName?: string | undefined,
    schemaName?: string | undefined,
  ) => string;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  setFilterText: React.Dispatch<React.SetStateAction<string>>;
  refreshSelectedTableMetadata: (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    driverPackageVersion?: string | null | undefined;
    connectionDatabaseName?: string | null | undefined;
    databaseName?: string | undefined;
    schema: string;
    tables: string[];
  }) => Promise<void>;
  copySelectedTableNames: (options: {
    scopeKey: string;
    tables: string[];
  }) => Promise<void>;
  showSelectedTableDdl: (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    driverPackageVersion?: string | null | undefined;
    connectionDatabaseName?: string | null | undefined;
    databaseName?: string | undefined;
    schema: string;
    tables: TableInfo[];
  }) => Promise<void>;
  schemaDiagramLoadingKey: string | null;
  handleOpenSchemaDiagram: (
    identity: SchemaSnapshotIdentity,
    selectedRelations?: readonly string[],
  ) => Promise<void>;
  exportSelectedTablesSql: (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    schema: string;
    tables: string[];
  }) => Promise<void>;
  cancelSelectedTableExport: () => Promise<void>;
  namespaceLabel: string;
}
