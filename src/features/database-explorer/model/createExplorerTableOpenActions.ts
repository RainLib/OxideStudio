import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import type { TableTabReuseMode } from "@/features/settings/model/settingsTypes";
import type { TablePageLoadOptions } from "@/features/workspace-tabs/model/types";
import {
  APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
  APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
  APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
  type TableCsvImportRequest,
  type TableJsonImportRequest,
  type TableXlsxImportRequest,
} from "@/lib/actionEvents";
import { databaseDriverProfile } from "@/lib/databaseDialect";
import type { TableInfo } from "@/services/tauri/types";
import type { TableFilter } from "@/services/tauri/types/tableRows";
import { useSchemaStore } from "@/store/useSchemaStore";

interface CreateExplorerTableOpenActionsContext {
  selectTable: (table: string | null) => void;
  currentSchema: string | null;
  activeConnectionId: string | null;
  connectedConnectionIds: string[];
  setActiveConnection: (id: string) => Promise<string | null>;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  handleSchemaSelect: (schema: string) => Promise<void>;
  connections: ConnectionConfig[];
  findOrCreateTableTab: (
    connectionId: string,
    schemaName: string,
    tableName: string,
    objectType?: string | null | undefined,
    databaseName?: string | undefined,
    options?: { reuseMode?: TableTabReuseMode | undefined } | undefined,
  ) => string;
  tableTabReuseMode: TableTabReuseMode;
  loadTablePage: (
    tabId: string,
    page?: number | undefined,
    filterSql?: string | null | undefined,
    filters?: TableFilter[] | null | undefined,
    options?: TablePageLoadOptions | undefined,
  ) => Promise<boolean>;
}

export function createExplorerTableOpenActions({
  selectTable,
  currentSchema,
  activeConnectionId,
  connectedConnectionIds,
  setActiveConnection,
  setNamespaceError,
  handleSchemaSelect,
  connections,
  findOrCreateTableTab,
  tableTabReuseMode,
  loadTablePage,
}: CreateExplorerTableOpenActionsContext) {
  const handleTableSelect = (tableName: string) => {
    selectTable(tableName);
  };

  const handleTableDoubleClick = async (
    table: TableInfo,
    schemaName = currentSchema || "",
    targetConnectionId = activeConnectionId || "",
    databaseName?: string,
  ) => {
    if (!schemaName || !targetConnectionId) return;

    if (
      activeConnectionId !== targetConnectionId ||
      !connectedConnectionIds.includes(targetConnectionId)
    ) {
      const connectionError = await setActiveConnection(targetConnectionId);
      if (connectionError) {
        setNamespaceError(connectionError);
        return;
      }
    }

    if (schemaName !== useSchemaStore.getState().currentSchema) {
      await handleSchemaSelect(schemaName);
    }

    const targetConnection = connections.find(
      (connection) => connection.id === targetConnectionId,
    );
    const resolvedDatabaseName =
      databaseName ||
      (targetConnection &&
      databaseDriverProfile(targetConnection.driver).capabilities
        .supportsDatabaseCatalogs
        ? connectionCatalogDatabaseName(targetConnection)
        : undefined);

    // Use findOrCreateTableTab to reuse existing tabs
    const tabId = findOrCreateTableTab(
      targetConnectionId,
      schemaName,
      table.name,
      table.type,
      resolvedDatabaseName,
      { reuseMode: tableTabReuseMode },
    );

    await loadTablePage(tabId, 0);
  };

  const handleTableCsvImport = async (
    table: TableInfo,
    schemaName: string,
    targetConnectionId = activeConnectionId || "",
    databaseName?: string,
  ) => {
    if (!targetConnectionId) return;
    await handleTableDoubleClick(
      table,
      schemaName,
      targetConnectionId,
      databaseName,
    );
    const detail: TableCsvImportRequest = {
      connectionId: targetConnectionId,
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
    targetConnectionId = activeConnectionId || "",
    databaseName?: string,
  ) => {
    if (!targetConnectionId) return;
    await handleTableDoubleClick(
      table,
      schemaName,
      targetConnectionId,
      databaseName,
    );
    const detail: TableJsonImportRequest = {
      connectionId: targetConnectionId,
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
    targetConnectionId = activeConnectionId || "",
    databaseName?: string,
  ) => {
    if (!targetConnectionId) return;
    await handleTableDoubleClick(
      table,
      schemaName,
      targetConnectionId,
      databaseName,
    );
    const detail: TableXlsxImportRequest = {
      connectionId: targetConnectionId,
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

  return {
    handleTableSelect,
    handleTableDoubleClick,
    handleTableCsvImport,
    handleTableJsonImport,
    handleTableXlsxImport,
    handlePostgresRemoteTableOpen,
  };
}
