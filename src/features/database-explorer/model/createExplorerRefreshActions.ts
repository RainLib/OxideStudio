import { confirmAction } from "@/lib/appDialogs";
import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  isEditableExplorerShortcutTarget,
  objectGroupKey,
  supportsDatabaseCatalogTree,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import type { PostgresRemoteDatabaseState } from "@/features/database-explorer/model/explorerSidebarTypes";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import type { SqlScriptImportTarget } from "@/features/sql-script-import/useSqlScriptImportController";
import {
  databaseDriverProfile,
  defaultDatabaseCapabilities,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import {
  parseDatabaseObjectNavigationKey,
  parseDatabaseSchemaNavigationKey,
} from "@/lib/databaseNavigation";
import { isExplorerRefreshShortcut } from "@/lib/keybindings";
import { schemaService } from "@/services/tauri";
import type { TableInfo } from "@/services/tauri/types";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types/database";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { type KeyboardEvent as ReactKeyboardEvent } from "react";

interface CreateExplorerRefreshActionsContext {
  handleSchemaSelect: (schema: string) => Promise<void>;
  activeConnectionId: string | null;
  canBrowseDatabaseCatalogs: boolean;
  setPostgresDatabaseRefreshVersion: React.Dispatch<
    React.SetStateAction<number>
  >;
  loadSchemas: (
    connectionId: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  currentSchema: string | null;
  canBrowseTables: boolean;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  activeCapabilities: DatabaseCapabilities;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  canBrowseCollections: boolean;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean | undefined,
    filter?: string | undefined,
    revalidateCached?: boolean | undefined,
  ) => Promise<void>;
  collectionNamespace: string;
  filterText: string;
  connections: ConnectionConfig[];
  setActiveConnection: (id: string) => Promise<string | null>;
  postgresRemoteRefreshVersionRef: React.RefObject<number>;
  setPostgresRemoteRefreshRequest: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      database: string;
      version: number;
      schema?: string | undefined;
    } | null>
  >;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
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
  forgetConnectionMetadata: (connectionId: string) => Promise<void>;
  setExpandedSchemaKeys: React.Dispatch<React.SetStateAction<string[]>>;
  setExpandedObjectGroupKeys: React.Dispatch<React.SetStateAction<string[]>>;
  forgetSchemaMetadata: (connectionId: string, schema: string) => Promise<void>;
  setCurrentSchema: (schema: string) => Promise<void>;
  setFilterText: React.Dispatch<React.SetStateAction<string>>;
  requestSqlScriptImport: (target: SqlScriptImportTarget) => Promise<void>;
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
  connectedConnectionIds: string[];
  setConnectingConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  expandedConnectionIds: string[];
  setExpandedConnectionIds: React.Dispatch<React.SetStateAction<string[]>>;
  postgresRemoteRequestCounter: React.RefObject<number>;
  postgresRemoteContextVersion: React.RefObject<number>;
  postgresRemoteRequestIds: React.RefObject<Record<string, number>>;
  setPostgresRemoteDatabases: React.Dispatch<
    React.SetStateAction<PostgresRemoteDatabaseState>
  >;
}

export function createExplorerRefreshActions({
  handleSchemaSelect,
  activeConnectionId,
  canBrowseDatabaseCatalogs,
  setPostgresDatabaseRefreshVersion,
  loadSchemas,
  currentSchema,
  canBrowseTables,
  loadTables,
  activeCapabilities,
  loadFunctions,
  canBrowseCollections,
  loadCollections,
  collectionNamespace,
  filterText,
  connections,
  setActiveConnection,
  postgresRemoteRefreshVersionRef,
  setPostgresRemoteRefreshRequest,
  setNamespaceError,
  refreshSelectedTableMetadata,
  forgetConnectionMetadata,
  setExpandedSchemaKeys,
  setExpandedObjectGroupKeys,
  forgetSchemaMetadata,
  setCurrentSchema,
  setFilterText,
  requestSqlScriptImport,
  selectExplorerNode,
  connectedConnectionIds,
  setConnectingConnectionIds,
  expandedConnectionIds,
  setExpandedConnectionIds,
  postgresRemoteRequestCounter,
  postgresRemoteContextVersion,
  postgresRemoteRequestIds,
  setPostgresRemoteDatabases,
}: CreateExplorerRefreshActionsContext) {
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
    const confirmed = (await confirmAction(
      `Forget cached metadata for "${connectionName}"? The next refresh will introspect the data source again.`,
    ));
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
    const confirmed = (await confirmAction(
      `Forget cached object metadata for "${schema}"? The schema will stay listed, but tables and routines will be loaded again on refresh.`,
    ));
    if (!confirmed) return;

    await forgetSchemaMetadata(connectionId, schema);
    const groupPrefix = objectGroupKey(connectionId, driver, schema, "");
    setExpandedObjectGroupKeys((current) =>
      current.filter((key) => !key.startsWith(groupPrefix)),
    );
  };

  const runForExplorerSchema = async (
    connectionId: string,
    schema: string,
    action: () => void | Promise<void>,
  ) => {
    const connectionState = useConnectionStore.getState();
    if (
      connectionState.activeConnectionId !== connectionId ||
      !connectionState.connectedConnectionIds.includes(connectionId)
    ) {
      const connectionError = await setActiveConnection(connectionId);
      if (connectionError) {
        setNamespaceError(connectionError);
        return;
      }
    }
    if (useSchemaStore.getState().currentSchema !== schema) {
      await setCurrentSchema(schema);
      setFilterText("");
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

  const handleConnectionSelect = async (
    connectionId: string,
    event?: {
      currentTarget: HTMLElement;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    selectExplorerNode(explorerNodeId("connection", connectionId), event);
    const isConnected = connectedConnectionIds.includes(connectionId);
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

  const handleConnectionToggle = async (
    connectionId: string,
    forceExpanded?: boolean,
  ) => {
    const isExpanded = expandedConnectionIds.includes(connectionId);
    const shouldExpand = forceExpanded ?? !isExpanded;
    setExpandedConnectionIds((current) =>
      shouldExpand
        ? current.includes(connectionId)
          ? current
          : [...current, connectionId]
        : current.filter((id) => id !== connectionId),
    );
    if (shouldExpand && !connectedConnectionIds.includes(connectionId)) {
      await handleConnectionSelect(connectionId);
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

  return {
    handleRefresh,
    handleRefreshConnection,
    handleRefreshSchema,
    handleExplorerKeyDownCapture,
    handleForgetConnectionMetadata,
    handleForgetSchemaMetadata,
    handleSchemaSelect,
    runForExplorerSchema,
    handleImportSqlScript,
    handleConnectionSelect,
    handleConnectionToggle,
    loadPostgresRemoteDatabase,
    handlePostgresRemoteTablesLoaded,
  };
}
