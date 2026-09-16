import { tableService } from "@/services/tauri";
import {
  isMetadataCacheSupersededError,
  MetadataCacheSupersededError,
} from "@/services/metadataCacheGeneration";
import { isMetadataConnectionScopeCurrent } from "@/services/metadataConnectionScope";
import {
  MAX_CACHED_OBJECT_SOURCE_AGE_MS,
  MAX_CACHED_OBJECT_SOURCE_CHARS,
  type TableMetadataIdentity,
} from "./contracts";
import { objectSourceLoadKey, resolveTableMetadataIdentity } from "./identity";
import {
  advanceCacheGeneration,
  cacheGenerations,
  captureCacheGeneration,
  objectSourceLoads,
  runObjectSourceLoad,
} from "./runtime";
import { persistTableMetadata, readCachedTableMetadata } from "./storage";

function isCachedObjectSourceFresh(updatedAt: number) {
  return (
    Number.isFinite(updatedAt) &&
    updatedAt > 0 &&
    Date.now() - updatedAt <= MAX_CACHED_OBJECT_SOURCE_AGE_MS
  );
}

export async function loadTableDdl(
  identity: TableMetadataIdentity,
  objectType?: string | null,
  force = false,
): Promise<string> {
  const resolvedIdentity = resolveTableMetadataIdentity(identity);
  const normalizedObjectType = objectType || null;
  const loadKey = objectSourceLoadKey(
    resolvedIdentity,
    "ddl",
    normalizedObjectType,
  );
  const existing = objectSourceLoads.get(loadKey);
  if (existing && (!force || existing.force)) return existing.promise;
  const request = force
    ? advanceCacheGeneration(resolvedIdentity)
    : captureCacheGeneration(resolvedIdentity);
  return runObjectSourceLoad(loadKey, force, async () => {
    const cached = await readCachedTableMetadata(resolvedIdentity);
    cacheGenerations.assertCurrent(request.scope, request.generation);
    if (
      !force &&
      typeof cached?.ddl === "string" &&
      (cached.ddlObjectType || null) === normalizedObjectType &&
      isCachedObjectSourceFresh(cached.ddlCachedAt || cached.updatedAt)
    ) {
      return cached.ddl;
    }

    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }

    const ddl = await tableService.getTableDdl(
      resolvedIdentity.connectionId,
      resolvedIdentity.driver,
      resolvedIdentity.schema,
      resolvedIdentity.table,
      objectType,
      resolvedIdentity.databaseName,
    );
    cacheGenerations.assertCurrent(request.scope, request.generation);
    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }
    if (ddl.length <= MAX_CACHED_OBJECT_SOURCE_CHARS) {
      try {
        await persistTableMetadata(
          resolvedIdentity,
          {
            ddl,
            ddlObjectType: normalizedObjectType,
            ddlCachedAt: Date.now(),
          },
          request.generation,
        );
      } catch (error) {
        if (isMetadataCacheSupersededError(error)) throw error;
        console.warn("Failed to persist table DDL cache", error);
      }
    }
    cacheGenerations.assertCurrent(request.scope, request.generation);
    return ddl;
  });
}

export async function loadViewDefinition(
  identity: TableMetadataIdentity,
  objectType?: string | null,
  force = false,
): Promise<string> {
  const resolvedIdentity = resolveTableMetadataIdentity(identity);
  const normalizedObjectType = objectType || null;
  const loadKey = objectSourceLoadKey(
    resolvedIdentity,
    "view-definition",
    normalizedObjectType,
  );
  const existing = objectSourceLoads.get(loadKey);
  if (existing && (!force || existing.force)) return existing.promise;
  const request = force
    ? advanceCacheGeneration(resolvedIdentity)
    : captureCacheGeneration(resolvedIdentity);
  if (resolvedIdentity.databaseName) {
    throw new Error(
      `View definitions are unavailable for read-only database "${resolvedIdentity.databaseName}".`,
    );
  }

  return runObjectSourceLoad(loadKey, force, async () => {
    const cached = await readCachedTableMetadata(resolvedIdentity);
    cacheGenerations.assertCurrent(request.scope, request.generation);
    if (
      !force &&
      typeof cached?.viewDefinition === "string" &&
      (cached.viewObjectType || null) === normalizedObjectType &&
      isCachedObjectSourceFresh(
        cached.viewDefinitionCachedAt || cached.updatedAt,
      )
    ) {
      return cached.viewDefinition;
    }

    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }

    const definition = await tableService.getViewDefinition(
      resolvedIdentity.connectionId,
      resolvedIdentity.driver,
      resolvedIdentity.schema,
      resolvedIdentity.table,
      objectType,
    );
    cacheGenerations.assertCurrent(request.scope, request.generation);
    if (!isMetadataConnectionScopeCurrent(resolvedIdentity)) {
      throw new MetadataCacheSupersededError();
    }
    if (definition.length <= MAX_CACHED_OBJECT_SOURCE_CHARS) {
      try {
        await persistTableMetadata(
          resolvedIdentity,
          {
            viewDefinition: definition,
            viewObjectType: normalizedObjectType,
            viewDefinitionCachedAt: Date.now(),
          },
          request.generation,
        );
      } catch (error) {
        if (isMetadataCacheSupersededError(error)) throw error;
        console.warn("Failed to persist view definition cache", error);
      }
    }
    cacheGenerations.assertCurrent(request.scope, request.generation);
    return definition;
  });
}
