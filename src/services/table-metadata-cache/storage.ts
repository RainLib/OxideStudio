import { storeService, type Resource } from "@/services/tauri";
import {
  TABLE_METADATA_CACHE_KIND,
  TABLE_METADATA_CACHE_VERSION,
  type StoredTableMetadata,
  type TableMetadataIdentity,
} from "./contracts";
import {
  resolveTableMetadataIdentity,
  scopedTableCacheKey,
  tableMetadataParentId,
  type ResolvedTableMetadataIdentity,
} from "./identity";
import {
  advanceCacheGeneration,
  cacheGenerations,
  cacheOperations,
  invalidateObjectSourceLoads,
} from "./runtime";

function tableMetadataResourceId(identity: TableMetadataIdentity) {
  return `${tableMetadataParentId(identity)}:${TABLE_METADATA_CACHE_KIND}`;
}

function parseCachedMetadata(
  resource: Resource | undefined,
  identity: ResolvedTableMetadataIdentity,
): StoredTableMetadata | null {
  const metadata = resource?.metadata as Partial<StoredTableMetadata> | undefined;
  if (
    !metadata ||
    metadata.version !== TABLE_METADATA_CACHE_VERSION ||
    metadata.driver !== identity.driver ||
    (metadata.driverPackageVersion || null) !== identity.driverPackageVersion ||
    (metadata.connectionDatabaseName || null) !== identity.connectionDatabaseName ||
    (metadata.databaseName || undefined) !== identity.databaseName ||
    metadata.schema !== identity.schema ||
    metadata.table !== identity.table ||
    metadata.projectId !== identity.projectId ||
    resource?.project_id !== identity.projectId
  ) {
    return null;
  }

  return metadata as StoredTableMetadata;
}

export async function readCachedTableMetadata(
  identity: TableMetadataIdentity,
): Promise<(StoredTableMetadata & { updatedAt: number }) | null> {
  const resolvedIdentity = resolveTableMetadataIdentity(identity);
  try {
    const resources = await storeService.getResources(
      resolvedIdentity.connectionId,
      tableMetadataParentId(resolvedIdentity),
      resolvedIdentity.projectId,
    );
    const resource = resources.find(
      (item) => item.kind === TABLE_METADATA_CACHE_KIND,
    );
    const metadata = parseCachedMetadata(resource, resolvedIdentity);
    return metadata
      ? { ...metadata, updatedAt: resource?.last_updated || 0 }
      : null;
  } catch {
    return null;
  }
}

export async function persistTableMetadata(
  identity: TableMetadataIdentity,
  patch: Partial<StoredTableMetadata>,
  expectedGeneration: number,
): Promise<StoredTableMetadata> {
  const resolvedIdentity = resolveTableMetadataIdentity(identity);
  const key = scopedTableCacheKey(resolvedIdentity);
  const previousOperation = cacheOperations.get(key) || Promise.resolve();
  const nextWrite = previousOperation
    .catch(() => null)
    .then(async () => {
      cacheGenerations.assertCurrent(key, expectedGeneration);
      const current = await readCachedTableMetadata(resolvedIdentity);
      cacheGenerations.assertCurrent(key, expectedGeneration);
      const metadata: StoredTableMetadata = {
        ...(current || {}),
        version: TABLE_METADATA_CACHE_VERSION,
        projectId: resolvedIdentity.projectId,
        driver: resolvedIdentity.driver,
        driverPackageVersion: resolvedIdentity.driverPackageVersion,
        connectionDatabaseName: resolvedIdentity.connectionDatabaseName,
        databaseName: resolvedIdentity.databaseName,
        schema: resolvedIdentity.schema,
        table: resolvedIdentity.table,
        ...patch,
      };
      delete (metadata as Partial<StoredTableMetadata> & { updatedAt?: number })
        .updatedAt;

      await storeService.saveResources(
        [
          {
            id: tableMetadataResourceId(resolvedIdentity),
            project_id: resolvedIdentity.projectId,
            connection_id: resolvedIdentity.connectionId,
            parent_id: tableMetadataParentId(resolvedIdentity),
            kind: TABLE_METADATA_CACHE_KIND,
            name: resolvedIdentity.table,
            metadata,
            last_updated: Date.now(),
          },
        ],
        resolvedIdentity.projectId,
      );
      return metadata;
    });

  cacheOperations.set(key, nextWrite);
  try {
    return await nextWrite;
  } finally {
    if (cacheOperations.get(key) === nextWrite) {
      cacheOperations.delete(key);
    }
  }
}

export async function invalidateTableMetadata(
  identity: TableMetadataIdentity,
): Promise<void> {
  const resolvedIdentity = resolveTableMetadataIdentity(identity);
  invalidateObjectSourceLoads(resolvedIdentity);
  const { scope } = advanceCacheGeneration(resolvedIdentity);
  const previousOperation = cacheOperations.get(scope) || Promise.resolve();
  const invalidation = previousOperation.catch(() => null).then(async () => {
    await storeService.deleteResources(
      resolvedIdentity.connectionId,
      tableMetadataParentId(resolvedIdentity),
      TABLE_METADATA_CACHE_KIND,
      resolvedIdentity.projectId,
    );
  });
  cacheOperations.set(scope, invalidation);
  try {
    await invalidation;
  } catch (error) {
    console.warn("Failed to invalidate table metadata cache", error);
  } finally {
    if (cacheOperations.get(scope) === invalidation) {
      cacheOperations.delete(scope);
    }
  }
}
