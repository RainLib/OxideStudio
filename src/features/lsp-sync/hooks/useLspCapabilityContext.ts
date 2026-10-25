import type { ConnectionConfig, ConnectionRuntimeState } from "@/features/connections/model/types";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
} from "@/lib/databaseDialect";
import { databaseService, type DatabaseCapabilities } from "@/services/tauri";
import type { DatabaseDriverCatalogStatus } from "@/store/useDatabaseDriverCatalogStore";
import { useEffect, useMemo, useState } from "react";

interface LspCapabilityContextOptions {
  activeConnection: ConnectionConfig | undefined;
  activeConnectionRuntime?: ConnectionRuntimeState;
  semanticSession?: string;
  driverCatalogStatus: DatabaseDriverCatalogStatus;
}

export function useLspCapabilityContext({
  activeConnection,
  activeConnectionRuntime,
  semanticSession,
  driverCatalogStatus,
}: LspCapabilityContextOptions) {
  type Context = {
    connectionId: string;
    capabilities: DatabaseCapabilities;
    serverVersion: string | null;
  };
  const [resolved, setResolved] = useState<{
    context: Context;
    runtime: ConnectionRuntimeState | undefined;
    driver: string;
    packageVersion: string | undefined;
    catalogStatus: DatabaseDriverCatalogStatus;
    semanticSession: string|undefined;
  } | null>(null);
  // A render for the replacement session must not expose the previous value
  // while waiting for the effect cleanup and the new network response.
  const resolvedCapabilityContext = resolved && activeConnection &&
    resolved.context.connectionId === activeConnection.id &&
    resolved.runtime === activeConnectionRuntime &&
    resolved.semanticSession === semanticSession &&
    resolved.driver === activeConnection.driver &&
    resolved.packageVersion === activeConnection.driverPackageVersion &&
    resolved.catalogStatus === driverCatalogStatus
      ? resolved.context : null;
  useEffect(() => {
    if (!activeConnection || activeConnectionRuntime && activeConnectionRuntime.status !== "connected") {
      setResolved(null);
      return;
    }
    let cancelled = false;
    setResolved(null);
    const publish = (context: Context) => {
      if (cancelled) return;
      setResolved({context, runtime: activeConnectionRuntime, driver: activeConnection.driver,
        packageVersion: activeConnection.driverPackageVersion, catalogStatus: driverCatalogStatus,semanticSession});
    };
    void databaseService
      .getConnectionDatabaseCapabilityContext(activeConnection.id)
      .then((context) => {
        if (!cancelled) {
          publish({
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
          publish({
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
    activeConnectionRuntime,
    semanticSession,
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
