import { useConnectionStore } from "@/store/useConnectionStore";
import type { DatabaseDriver } from "@/services/tauri/types";

export interface MetadataConnectionScopeInput {
  connectionId: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
}

export type ResolvedMetadataConnectionScope = MetadataConnectionScopeInput & {
  driverPackageVersion: string | null;
  connectionDatabaseName: string | null;
};

function normalizedScopeValue(value: string | null | undefined) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Cache callers may already own an exact connection snapshot. When they do
 * not, resolve the package/database identity from the current saved
 * connection so metadata produced by one package or configured database is
 * never reused after that connection is edited in place.
 */
export function resolveMetadataConnectionScope<T extends MetadataConnectionScopeInput>(
  input: T,
): T & ResolvedMetadataConnectionScope {
  const connection = useConnectionStore
    .getState()
    .connections.find(
      (candidate) =>
        candidate.id === input.connectionId && candidate.driver === input.driver,
    );
  return {
    ...input,
    driverPackageVersion: normalizedScopeValue(
      input.driverPackageVersion !== undefined
        ? input.driverPackageVersion
        : connection?.driverPackageVersion,
    ),
    connectionDatabaseName: normalizedScopeValue(
      input.connectionDatabaseName !== undefined
        ? input.connectionDatabaseName
        : connection?.database,
    ),
  };
}
