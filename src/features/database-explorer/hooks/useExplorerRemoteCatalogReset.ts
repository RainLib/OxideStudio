import type { PostgresRemoteDatabaseState } from "@/features/database-explorer/model/explorerSidebarTypes";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useEffect } from "react";

interface UseExplorerRemoteCatalogResetContext {
  postgresRemoteContextVersion: React.RefObject<number>;
  setPostgresRemoteDatabases: React.Dispatch<
    React.SetStateAction<PostgresRemoteDatabaseState>
  >;
  canBrowseDatabaseCatalogs: boolean;
  activeConnectionId: string | null;
  activeDriver: DatabaseDriver;
  postgresDatabaseRefreshVersion: number;
}

export function useExplorerRemoteCatalogReset({
  postgresRemoteContextVersion,
  setPostgresRemoteDatabases,
  canBrowseDatabaseCatalogs,
  activeConnectionId,
  activeDriver,
  postgresDatabaseRefreshVersion,
}: UseExplorerRemoteCatalogResetContext) {
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
}
