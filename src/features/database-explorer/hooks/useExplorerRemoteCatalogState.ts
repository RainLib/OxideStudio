import { type PostgresRemoteDatabaseState } from "@/features/database-explorer/model/explorerSidebarTypes";
import { useRef, useState } from "react";
export function useExplorerRemoteCatalogState() {
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
  return {
    postgresDatabaseRefreshVersion,
    setPostgresDatabaseRefreshVersion,
    postgresRemoteRefreshVersionRef,
    postgresRemoteRefreshRequest,
    setPostgresRemoteRefreshRequest,
    postgresRemoteDatabases,
    setPostgresRemoteDatabases,
    postgresRemoteRequestIds,
    postgresRemoteRequestCounter,
    postgresRemoteContextVersion,
  };
}
