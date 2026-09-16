import type { ConnectionConfig } from "@/features/connections/model/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService } from "@/services/tauri";
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
    capabilities: DatabaseCapabilities;
  } | null>(null);
  const driverCatalogStatus = useDatabaseDriverCatalogStore(
    (state) => state.status,
  );

  useEffect(() => {
    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(activeDriver);
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return () => {
        cancelled = true;
      };
    }
    setConnectionCapabilities(null);

    databaseService
      .getDatabaseCapabilities(
        activeDriver,
        activeConnection?.driverPackageVersion,
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
        console.error("Failed to load database capabilities:", error);
        if (!cancelled) {
          setConnectionCapabilities({
            connectionId: activeConnection.id,
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
    activeDriver,
    driverCatalogStatus,
  ]);

  return { connectionCapabilities };
}
