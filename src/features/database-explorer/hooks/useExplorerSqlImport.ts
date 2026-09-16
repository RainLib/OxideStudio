import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { supportsDatabaseCatalogTree } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { useSqlScriptImportController } from "@/features/sql-script-import";
interface UseExplorerSqlImportContext {
  connectionAvailabilityKey: string;
  connections: ConnectionConfig[];
  setActiveConnection: (id: string) => Promise<string | null>;
  bumpMetadataVersion: () => void;
  setPostgresDatabaseRefreshVersion: React.Dispatch<
    React.SetStateAction<number>
  >;
  loadSchemas: (
    connectionId: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  loadTables: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
}
export function useExplorerSqlImport({
  connectionAvailabilityKey,
  connections,
  setActiveConnection,
  bumpMetadataVersion,
  setPostgresDatabaseRefreshVersion,
  loadSchemas,
  loadTables,
  setNamespaceError,
}: UseExplorerSqlImportContext) {
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
  return {
    pendingSqlScriptImport,
    isSqlScriptImporting,
    requestSqlScriptImport,
    handleConfirmSqlScriptImport,
    closeSqlScriptImport,
  };
}
