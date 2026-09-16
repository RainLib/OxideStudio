import { connectionCatalogDatabaseName } from "@/features/connections/model/catalogDatabase";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { mergeCatalogNames } from "@/features/query-editor/model/catalogSelection";
import { usePostgresDatabaseDiscovery } from "@/hooks/usePostgresDatabaseDiscovery";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService, type DatabaseCapabilities } from "@/services/tauri";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import type { DatabaseDriverCatalogStatus } from "@/store/useDatabaseDriverCatalogStore";
import { useEffect, useMemo, useState } from "react";

interface EditorConnectionCatalogOptions {
  activeConnection: ConnectionConfig | undefined;
  driverCatalogStatus: DatabaseDriverCatalogStatus;
  driver: DatabaseDriver;
  activeProjectId: string;
  effectiveConnectionId: string | null;
  connectedConnectionIds: string[];
  metadataVersion: number;
}

export function useEditorConnectionCatalog({
  activeConnection,
  driverCatalogStatus,
  driver,
  activeProjectId,
  effectiveConnectionId,
  connectedConnectionIds,
  metadataVersion,
}: EditorConnectionCatalogOptions) {
  const [connectionCapabilities, setConnectionCapabilities] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
  } | null>(null);
  useEffect(() => {
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return;
    }
    let cancelled = false;
    setConnectionCapabilities(null);
    const liveCapabilityRequest =
      typeof databaseService.getConnectionDatabaseCapabilityContext ===
      "function"
        ? databaseService
            .getConnectionDatabaseCapabilityContext(activeConnection.id)
            .then((context) => context.capabilities)
        : Promise.reject(new Error("Live capability context unavailable"));
    void liveCapabilityRequest
      .catch(() =>
        databaseService.getDatabaseCapabilities(
          activeConnection.driver,
          activeConnection.driverPackageVersion,
        ),
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
        console.warn("Failed to load query-editor driver capabilities", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            capabilities: defaultDatabaseCapabilities(activeConnection.driver),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeConnection?.driver,
    activeConnection?.driverPackageVersion,
    activeConnection?.id,
    driverCatalogStatus,
  ]);
  const capabilities = useMemo(() => {
    const resolvedCapabilities =
      connectionCapabilities &&
      connectionCapabilities.connectionId === activeConnection?.id
        ? connectionCapabilities.capabilities
        : null;
    return resolvedCapabilities?.driver.toLowerCase() === driver.toLowerCase()
      ? resolvedCapabilities
      : defaultDatabaseCapabilities(driver);
  }, [activeConnection?.id, connectionCapabilities, driver]);
  const canBrowseDatabaseCatalogs = Boolean(
    capabilities.supportsDatabaseCatalogs,
  );
  // Network catalog drivers retain one configured database on the connection.
  // File-backed engines such as DuckDB return an empty value here and discover
  // their primary catalog through metadata instead.
  const configuredCatalogDatabase =
    activeConnection && canBrowseDatabaseCatalogs
      ? connectionCatalogDatabaseName(activeConnection)
      : null;
  const postgresDatabaseDiscovery = usePostgresDatabaseDiscovery({
    projectId: activeProjectId,
    connectionId: effectiveConnectionId || null,
    driver: activeConnection?.driver,
    driverPackageVersion: activeConnection?.driverPackageVersion,
    connectionDatabaseName: activeConnection?.database,
    canBrowseDatabaseCatalogs,
    isConnectionReady: Boolean(
      effectiveConnectionId &&
        connectedConnectionIds.includes(effectiveConnectionId),
    ),
    refreshVersion: metadataVersion,
  });
  const catalogDatabases = useMemo(() => {
    if (!canBrowseDatabaseCatalogs) return [];
    const discovered =
      postgresDatabaseDiscovery.connectionId === effectiveConnectionId
        ? postgresDatabaseDiscovery.databases
        : [];
    return mergeCatalogNames(configuredCatalogDatabase, discovered);
  }, [
    canBrowseDatabaseCatalogs,
    configuredCatalogDatabase,
    effectiveConnectionId,
    postgresDatabaseDiscovery.connectionId,
    postgresDatabaseDiscovery.databases,
  ]);

  return {
    capabilities,
    canBrowseDatabaseCatalogs,
    configuredCatalogDatabase,
    postgresDatabaseDiscovery,
    catalogDatabases,
  };
}
