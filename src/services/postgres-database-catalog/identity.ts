import { resolveMetadataConnectionScope } from "@/services/metadataConnectionScope";
import type {
  PostgresDatabaseCatalogIdentity,
  ResolvedPostgresDatabaseCatalogIdentity,
} from "./contracts";
import { POSTGRES_DATABASE_CATALOG_CACHE_KIND } from "./contracts";

export function resolvePostgresDatabaseCatalogIdentity(
  identity: PostgresDatabaseCatalogIdentity,
): ResolvedPostgresDatabaseCatalogIdentity {
  return {
    ...identity,
    ...resolveMetadataConnectionScope(identity),
  };
}

export function postgresDatabaseCatalogKey(
  identity: PostgresDatabaseCatalogIdentity,
) {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  return JSON.stringify([
    resolvedIdentity.projectId,
    resolvedIdentity.connectionId,
    resolvedIdentity.driver,
    resolvedIdentity.driverPackageVersion,
    resolvedIdentity.connectionDatabaseName,
  ]);
}

export function postgresDatabaseCatalogParentId(
  identity: PostgresDatabaseCatalogIdentity,
) {
  const resolvedIdentity = resolvePostgresDatabaseCatalogIdentity(identity);
  return `oxide:server-catalog:v2:${encodeURIComponent(
    JSON.stringify([
      resolvedIdentity.connectionId,
      resolvedIdentity.driver,
      resolvedIdentity.driverPackageVersion,
      resolvedIdentity.connectionDatabaseName,
    ]),
  )}`;
}

export function postgresDatabaseCatalogResourceId(
  identity: PostgresDatabaseCatalogIdentity,
) {
  return `${postgresDatabaseCatalogParentId(
    identity,
  )}:${POSTGRES_DATABASE_CATALOG_CACHE_KIND}`;
}

export function normalizePostgresDatabaseCatalog(databases: readonly string[]) {
  const unique = new Set<string>();
  for (const database of databases) {
    const normalized = database.trim();
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique);
}
