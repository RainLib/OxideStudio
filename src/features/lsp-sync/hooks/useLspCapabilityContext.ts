import type { ConnectionConfig } from "@/features/connections/model/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
} from "@/lib/databaseDialect";
import { databaseService, type DatabaseCapabilities } from "@/services/tauri";
import type { DatabaseDriverCatalogStatus } from "@/store/useDatabaseDriverCatalogStore";
import { useEffect, useMemo, useState } from "react";

interface LspCapabilityContextOptions {
  activeConnection: ConnectionConfig | undefined;
  driverCatalogStatus: DatabaseDriverCatalogStatus;
}

export function useLspCapabilityContext({
  activeConnection,
  driverCatalogStatus,
}: LspCapabilityContextOptions) {
  const [resolvedCapabilityContext, setResolvedCapabilityContext] = useState<{
    connectionId: string;
    capabilities: DatabaseCapabilities;
    serverVersion: string | null;
  } | null>(null);
  useEffect(() => {
    if (!activeConnection) {
      setResolvedCapabilityContext(null);
      return;
    }
    let cancelled = false;
    setResolvedCapabilityContext(null);
    void databaseService
      .getConnectionDatabaseCapabilityContext(activeConnection.id)
      .then((context) => {
        if (!cancelled) {
          setResolvedCapabilityContext({
            connectionId: activeConnection.id,
            capabilities: context.capabilities,
            serverVersion: context.serverVersion || null,
          });
        }
      })
      .catch(async (error) => {
        console.warn(
          `[LSP] Failed to resolve live capability context for ${activeConnection.name}:`,
          error,
        );
        let capabilities: DatabaseCapabilities;
        try {
          capabilities = await databaseService.getDatabaseCapabilities(
            activeConnection.driver,
            activeConnection.driverPackageVersion,
          );
        } catch {
          capabilities = defaultDatabaseCapabilities(activeConnection.driver);
        }
        if (!cancelled) {
          setResolvedCapabilityContext({
            connectionId: activeConnection.id,
            capabilities,
            serverVersion: null,
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
  const lspCapabilities = useMemo<DatabaseCapabilities>(() => {
    const resolvedForActiveConnection =
      resolvedCapabilityContext &&
      activeConnection &&
      resolvedCapabilityContext.connectionId === activeConnection.id
        ? resolvedCapabilityContext.capabilities
        : null;
    if (resolvedForActiveConnection) {
      return resolvedForActiveConnection;
    }
    return defaultDatabaseCapabilities(
      activeConnection?.driver || DEFAULT_DATABASE_DRIVER,
    );
  }, [
    activeConnection?.driver,
    activeConnection?.id,
    resolvedCapabilityContext,
  ]);

  return { resolvedCapabilityContext, lspCapabilities };
}
