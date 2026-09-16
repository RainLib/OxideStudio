import { schemaService } from "@/services/tauri";
import {
  isMetadataCacheSupersededError,
  MetadataCacheSupersededError,
} from "@/services/metadataCacheGeneration";
import { isMetadataConnectionScopeCurrent } from "@/services/metadataConnectionScope";
import type {
  LoadTableMetadataOptions,
  StoredTableMetadata,
  TableMetadataSnapshot,
} from "./contracts";
import {
  metadataLoadKey,
  remoteMetadataScope,
  resolveTableMetadataIdentity,
  scopedTableCacheKey,
} from "./identity";
import {
  advanceCacheGeneration,
  cacheGenerations,
  captureCacheGeneration,
  invalidateObjectSourceLoads,
  metadataLoads,
  remoteMetadataLimiter,
} from "./runtime";
import { persistTableMetadata, readCachedTableMetadata } from "./storage";

function cachedSnapshot(
  cached: StoredTableMetadata & { updatedAt: number },
): TableMetadataSnapshot {
  return {
    columns: cached.columns || [],
    indexes: cached.indexes || [],
    constraints: cached.constraints || [],
    ddl: cached.ddl || null,
    viewDefinition: cached.viewDefinition || null,
    source: "cache",
    updatedAt: cached.updatedAt,
  };
}

async function loadTableMetadataRemote(
  options: LoadTableMetadataOptions,
  cached: (StoredTableMetadata & { updatedAt: number }) | null,
  expectedGeneration: number,
): Promise<TableMetadataSnapshot> {
  const resolvedOptions = resolveTableMetadataIdentity(options);
  const scope = scopedTableCacheKey(resolvedOptions);
  if (!isMetadataConnectionScopeCurrent(resolvedOptions)) {
    throw new MetadataCacheSupersededError();
  }
  cacheGenerations.assertCurrent(scope, expectedGeneration);
  const includeIndexes = options.includeIndexes !== false;
  const includeConstraints = options.includeConstraints !== false;
  const shouldLoadColumns = options.force || !Array.isArray(cached?.columns);
  const shouldLoadIndexes =
    includeIndexes && (options.force || !Array.isArray(cached?.indexes));
  const shouldLoadConstraints =
    includeConstraints && (options.force || !Array.isArray(cached?.constraints));

  const columnsPromise = shouldLoadColumns
    ? resolvedOptions.databaseName
      ? schemaService.getDatabaseColumns(
          resolvedOptions.connectionId,
          resolvedOptions.databaseName,
          resolvedOptions.schema,
          resolvedOptions.table,
        )
      : schemaService.getColumns(
          resolvedOptions.connectionId,
          resolvedOptions.schema,
          resolvedOptions.table,
        )
    : Promise.resolve(cached?.columns || []);
  const indexesPromise = shouldLoadIndexes
    ? (resolvedOptions.databaseName
        ? schemaService.getDatabaseIndexes(
            resolvedOptions.connectionId,
            resolvedOptions.databaseName,
            resolvedOptions.schema,
            resolvedOptions.table,
          )
        : schemaService.getIndexes(
            resolvedOptions.connectionId,
            resolvedOptions.schema,
            resolvedOptions.table,
          )
      ).catch((error) => {
        console.warn("Failed to refresh cached table indexes", error);
        return cached?.indexes || [];
      })
    : Promise.resolve(cached?.indexes || []);
  const constraintsPromise = shouldLoadConstraints
    ? (resolvedOptions.databaseName
        ? schemaService.getDatabaseConstraints(
            resolvedOptions.connectionId,
            resolvedOptions.databaseName,
            resolvedOptions.schema,
            resolvedOptions.table,
          )
        : schemaService.getConstraints(
            resolvedOptions.connectionId,
            resolvedOptions.schema,
            resolvedOptions.table,
          )
      ).catch((error) => {
        console.warn("Failed to refresh cached table constraints", error);
        return cached?.constraints || [];
      })
    : Promise.resolve(cached?.constraints || []);

  const [columns, indexes, constraints] = await Promise.all([
    columnsPromise,
    indexesPromise,
    constraintsPromise,
  ]);
  cacheGenerations.assertCurrent(scope, expectedGeneration);
  if (!isMetadataConnectionScopeCurrent(resolvedOptions)) {
    throw new MetadataCacheSupersededError();
  }
  const updatedAt = Date.now();
  const patch: Partial<StoredTableMetadata> = { columns };
  if (includeIndexes) patch.indexes = indexes;
  if (includeConstraints) patch.constraints = constraints;
  if (options.force) {
    patch.ddl = null;
    patch.ddlCachedAt = null;
    patch.viewDefinition = null;
    patch.viewDefinitionCachedAt = null;
  }

  try {
    await persistTableMetadata(resolvedOptions, patch, expectedGeneration);
  } catch (error) {
    if (isMetadataCacheSupersededError(error)) throw error;
    console.warn("Failed to persist table metadata cache", error);
  }
  cacheGenerations.assertCurrent(scope, expectedGeneration);

  return {
    columns,
    indexes,
    constraints,
    ddl: options.force ? null : cached?.ddl || null,
    viewDefinition: options.force ? null : cached?.viewDefinition || null,
    source: "remote",
    updatedAt,
  };
}

export async function loadTableMetadata(
  options: LoadTableMetadataOptions,
): Promise<TableMetadataSnapshot> {
  const resolvedOptions = resolveTableMetadataIdentity(options);
  if (options.force) invalidateObjectSourceLoads(resolvedOptions);
  const request = options.force
    ? advanceCacheGeneration(resolvedOptions)
    : captureCacheGeneration(resolvedOptions);
  const cached = await readCachedTableMetadata(resolvedOptions);
  cacheGenerations.assertCurrent(request.scope, request.generation);
  const cacheSatisfiesRequest = Boolean(
    !options.force &&
      Array.isArray(cached?.columns) &&
      (options.includeIndexes === false || Array.isArray(cached?.indexes)) &&
      (options.includeConstraints === false ||
        Array.isArray(cached?.constraints)),
  );
  if (cached && cacheSatisfiesRequest) {
    return cachedSnapshot(cached);
  }

  const key = metadataLoadKey(resolvedOptions, request.generation);
  if (!options.force) {
    const pending = metadataLoads.get(key);
    if (pending) return pending;
  }

  const load = remoteMetadataLimiter.run(
    remoteMetadataScope(resolvedOptions),
    "table-metadata",
    () => loadTableMetadataRemote(resolvedOptions, cached, request.generation),
    resolvedOptions.priority,
  );
  metadataLoads.set(key, load);
  try {
    return await load;
  } finally {
    if (metadataLoads.get(key) === load) {
      metadataLoads.delete(key);
    }
  }
}
