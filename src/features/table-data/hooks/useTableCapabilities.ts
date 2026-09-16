import type { ConnectionConfig } from "@/features/connections/model/types";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService } from "@/services/tauri";
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
  } | null>(null);
  const resolvedCapabilities =
    connectionCapabilities &&
    connectionCapabilities.connectionId === activeConnection?.id
      ? connectionCapabilities.capabilities
      : null;
  const activeCapabilities =
    resolvedCapabilities?.driver === driver
      ? resolvedCapabilities
      : defaultDatabaseCapabilities(driver);

  useEffect(() => {
    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(driver);
    if (!activeConnection) {
      setConnectionCapabilities(null);
      return () => {
        cancelled = true;
      };
    }
    setConnectionCapabilities(null);

    databaseService
      .getDatabaseCapabilities(driver, activeConnection?.driverPackageVersion)
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
    driver,
    driverCatalogStatus,
  ]);

  return { activeCapabilities };
}
