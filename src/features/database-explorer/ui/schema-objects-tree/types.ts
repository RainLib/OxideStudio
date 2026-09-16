import type { ConnectionConfig } from "@/features/connections/model/types";
import type { ExplorerTableBatchSelection } from "@/features/database-explorer/model/explorerSidebarTypes";
import type { ExplorerVisibilityFilter } from "@/features/database-explorer/model/explorerVisibilityFilter";
import type { TableBatchFailureDetail, TableBatchSelection } from "@/features/database-explorer/model/tableBatchSelection";
import type { useExplorerHistoryMenu } from "@/features/database-explorer/ui/useExplorerHistoryMenu";
import type { MetadataNodeState } from "@/features/schema-metadata/model/types";
import type { RedisKeyTreeNode } from "@/lib/redisKey";
import type { SchemaSnapshotIdentity } from "@/services/schemaSnapshotStore";
import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types/database";
import type { CollectionInfo, FunctionInfo, TableInfo } from "@/services/tauri/types/schemaCatalog";
import type { JSX } from "react";

export interface SchemaObjectsTreeContext {
  setIsTablesHovered: React.Dispatch<React.SetStateAction<boolean>>;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  schema: string;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  groupKey: string;
  isObjectGroupExpanded: boolean;
  activeCapabilities: DatabaseCapabilities;
  objectSectionLabel: string;
  hasSchemaObjectContext: boolean;
  schemaObjectCountLabel: string | number;
  schemaNodeState: MetadataNodeState | undefined;
  isCurrentSchema: boolean;
  isTablesHovered: boolean;
  renderObjectActions: () => React.JSX.Element | null;
  canBrowseTables: boolean;
  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  createTableTab: (connectionId: string, schemaName: string) => string;
  canBrowseCollections: boolean;
  handleCreateCollectionClick: () => void;
  collectionLabel: string;
  copyText: (value: string) => Promise<void>;
  openObjectBrowser: (
    connectionId: string,
    connectionName: string,
    databaseName?: string | undefined,
    schemaName?: string | undefined,
  ) => string;
  objectConnection: ConnectionConfig | undefined;
  openScopedQueryConsole: () => void;
  renderSqlHistorySubmenu: ReturnType<
    typeof useExplorerHistoryMenu
  >["renderSqlHistorySubmenu"];
  tableRelationNames: string[];
  addTablesToAssistant: (tableNames: readonly string[]) => Promise<void>;
  isLoading: boolean;
  isCollectionsLoading: boolean;
  handleRefreshSchema: (connectionId: string, schema: string) => Promise<void>;
  tableRelations: TableInfo[];
  setTableBatchSelection: React.Dispatch<
    React.SetStateAction<ExplorerTableBatchSelection | null>
  >;
  filterText: string;
  setFilterText: React.Dispatch<React.SetStateAction<string>>;
  isTableBatchSelectionActive: boolean;
  tableBatchAction: {
    scopeKey: string;
    running: boolean;
    message: string;
    cancelId?: string | undefined;
    failures?: TableBatchFailureDetail[] | undefined;
    omittedFailures?: number | undefined;
  } | null;
  allVisibleTablesSelected: boolean;
  selectedTableBatchNames: string[];
  scopedTableBatchSelection: TableBatchSelection;
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
  driver: string | null | undefined;
  activeDriver: DatabaseDriver;
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
    selectedRelations?: readonly string[] | undefined,
  ) => Promise<void>;
  activeProjectId: string;
  objectDriver: DatabaseDriver | undefined;
  exportSelectedTablesSql: (options: {
    scopeKey: string;
    connectionId: string;
    driver: DatabaseDriver;
    schema: string;
    tables: string[];
  }) => Promise<void>;
  handleOpenDataTransfer: (options: {
    connection: ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
    scope: "database" | "table" | "schema";
  }) => Promise<void>;
  handleOpenDataCompare: (options: {
    connection: ConnectionConfig;
    database?: string | undefined;
    schema?: string | undefined;
    table?: string | undefined;
    tables?: string[] | undefined;
  }) => Promise<void>;
  cancelSelectedTableExport: () => Promise<void>;
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
  namespaceLabel: string;
  schemaObjects: {
    tables: TableInfo[];
    collections: CollectionInfo[];
    functions: FunctionInfo[];
    pinnedTables: string[];
    hasSnapshot: boolean;
  };
  collectionLabelPlural: string;
  collectionNextCursor: string | null;
  objectVisibilityFilter: ExplorerVisibilityFilter | undefined;
  clearExplorerVisibilityFilter: (
    scopeId: string,
    parentNodeId: string,
  ) => void;
  explorerStateScope: string;
  objectVisibilityParentId: string;
  renderLoadMoreKeys: () => JSX.Element | null;
  renderRedisKeyNodes: (
    nodes: RedisKeyTreeNode<CollectionInfo>[],
    depth?: number,
  ) => React.ReactNode;
  explorerTreeRowHeight: 22 | 28;
  renderCollectionItem: (
    collection: CollectionInfo,
    label?: string | undefined,
    depth?: number,
  ) => JSX.Element;
  expandedTableKeys: string[];
  isSchemaObjectsLoading: boolean;
  renderTableItem: (table: TableInfo) => JSX.Element;
  renderVirtualViews: () => JSX.Element | null;
  renderRoutines: () => JSX.Element | null;
  renderSchemaObjectDescriptors: () => JSX.Element | null;
}
