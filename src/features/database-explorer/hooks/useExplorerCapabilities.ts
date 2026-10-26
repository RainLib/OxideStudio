import type { ConnectionConfig } from "@/features/connections/model/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService } from "@/services/tauri";
import { managedCapabilitiesFallback } from "@/features/connections/model/managedCapabilities";
import type { DatabaseCapabilities } from "@/services/tauri/types";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useDatabaseDriverCatalogStore } from "@/store/useDatabaseDriverCatalogStore";
import { useEffect, useState } from "react";

interface UseExplorerCapabilitiesContext {
  activeDriver: DatabaseDriver;
  activeConnection: ConnectionConfig | undefined;
}

export function useExplorerCapabilities({
  activeDriver,
  activeConnection,
}: UseExplorerCapabilitiesContext) {
  const [connectionCapabilities, setConnectionCapabilities] = useState<{
    connectionId: string;
    connection: ConnectionConfig;
    capabilities: DatabaseCapabilities;
  } | null>(null);
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );

  useEffect(() => {
    let cancelled = false;
    const fallback = activeConnection?.origin === "managed" ? managedCapabilitiesFallback(defaultDatabaseCapabilities(activeDriver)) : defaultDatabaseCapabilities(activeDriver);
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return () => {
        cancelled = true;
      };
    }
    setConnectionCapabilities(null);

    const request=activeConnection.origin === "managed"
      ? databaseService.getConnectionDatabaseCapabilityContext(activeConnection.id).then(context=>context.capabilities)
      : databaseService.getDatabaseCapabilities(activeDriver,activeConnection.driverPackageVersion);
    request
      .then((nextCapabilities) => {
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            connection:activeConnection,
            capabilities: nextCapabilities,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
            connection:activeConnection,
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
    activeDriver,
    driverCatalogStatus,
  ]);

  return { connectionCapabilities:connectionCapabilities?.connection===activeConnection?connectionCapabilities:null };
}
