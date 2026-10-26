import type { ConnectionConfig } from "@/features/connections/model/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService } from "@/services/tauri";
import { managedCapabilitiesFallback } from "@/features/connections/model/managedCapabilities";
import type { DatabaseCapabilities } from "@/services/tauri/types";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useEffect, useState } from "react";

interface TableCapabilitiesOptions {
  driver: DatabaseDriver;
  activeConnection: ConnectionConfig | undefined;
}

export function useTableCapabilities({
  driver,
  activeConnection,
}: TableCapabilitiesOptions) {
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );
  const [connectionCapabilities, setConnectionCapabilities] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
    connection: ConnectionConfig;
  } | null>(null);
  const resolvedCapabilities =
    connectionCapabilities &&
    connectionCapabilities.connection === activeConnection
      ? connectionCapabilities.capabilities
      : null;
  const activeCapabilities =
    resolvedCapabilities?.driver === driver
      ? resolvedCapabilities
      : activeConnection?.origin === "managed" ? managedCapabilitiesFallback(defaultDatabaseCapabilities(driver)) : defaultDatabaseCapabilities(driver);

  useEffect(() => {
    let cancelled = false;
    const fallback = activeConnection?.origin === "managed" ? managedCapabilitiesFallback(defaultDatabaseCapabilities(driver)) : defaultDatabaseCapabilities(driver);
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return () => {
        cancelled = true;
      };
    }
    setConnectionCapabilities(null);

    const request=activeConnection.origin === "managed"
      ? databaseService.getConnectionDatabaseCapabilityContext(activeConnection.id).then(context=>context.capabilities)
      : databaseService.getDatabaseCapabilities(driver, activeConnection.driverPackageVersion);
    request
      .then((nextCapabilities) => {
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            connection: activeConnection,
            capabilities: nextCapabilities,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            connection: activeConnection,
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
    activeConnection,
    driver,
    driverCatalogStatus,
  ]);

  return { activeCapabilities };
}
