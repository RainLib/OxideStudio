import {
  schemaService,
  storeService,
  tableService,
  type Resource,
} from "@/services/tauri";
import type {
  ColumnInfo,
  ConstraintInfo,
  DatabaseDriver,
  IndexInfo,
} from "@/services/tauri/types";
import {
  isMetadataCacheSupersededError,
  MetadataCacheGenerationRegistry,
} from "@/services/metadataCacheGeneration";
import {
  resolveMetadataConnectionScope,
  type ResolvedMetadataConnectionScope,
} from "@/services/metadataConnectionScope";

const TABLE_METADATA_CACHE_KIND = "TABLE_METADATA_CACHE";
const TABLE_METADATA_CACHE_VERSION = 3;
const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";

export interface TableMetadataIdentity {
  projectId?: string;
  connectionId: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
  databaseName?: string;
  schema: string;
  table: string;
}

export interface LoadTableMetadataOptions extends TableMetadataIdentity {
  includeIndexes?: boolean;
  includeConstraints?: boolean;
  force?: boolean;
}

export interface TableMetadataSnapshot {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
  ddl: string | null;
  viewDefinition: string | null;
  source: "cache" | "remote";
  updatedAt: number;
}

interface StoredTableMetadata {
  version: number;
  projectId?: string;
  driver: DatabaseDriver;
  driverPackageVersion: string | null;
  connectionDatabaseName: string | null;
  databaseName?: string;
  schema: string;
  table: string;
  columns?: ColumnInfo[];
  indexes?: IndexInfo[];
  constraints?: ConstraintInfo[];
  ddl?: string | null;
  ddlObjectType?: string | null;
  viewDefinition?: string | null;
  viewObjectType?: string | null;
}

const metadataLoads = new Map<string, Promise<TableMetadataSnapshot>>();
const cacheOperations = new Map<string, Promise<unknown>>();
const cacheGenerations = new MetadataCacheGenerationRegistry();

type ResolvedTableMetadataIdentity = TableMetadataIdentity & {
  projectId: string;
} & ResolvedMetadataConnectionScope;

function activeProjectId() {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

function resolveIdentity<T extends TableMetadataIdentity>(
  identity: T
): T & ResolvedTableMetadataIdentity {
  return {
    ...resolveMetadataConnectionScope(identity),
    projectId: identity.projectId || activeProjectId(),
    databaseName: identity.databaseName || undefined,
  };
}

function tableCacheKey(identity: ResolvedTableMetadataIdentity) {
  return `oxide:table-metadata:v3:${encodeURIComponent(
    JSON.stringify([
      identity.projectId,
      identity.connectionId,
      identity.driver,
      identity.driverPackageVersion,
      identity.connectionDatabaseName,
      identity.databaseName,
      identity.schema,
      identity.table,
    ])
  )}`;
}

function scopedTableCacheKey(identity: ResolvedTableMetadataIdentity) {
  return `${encodeURIComponent(identity.projectId)}:${tableCacheKey(identity)}`;
}

function captureCacheGeneration(identity: ResolvedTableMetadataIdentity) {
  const scope = scopedTableCacheKey(identity);
  return { scope, generation: cacheGenerations.capture(scope) };
}

function advanceCacheGeneration(identity: ResolvedTableMetadataIdentity) {
  const scope = scopedTableCacheKey(identity);
  return { scope, generation: cacheGenerations.advance(scope) };
}

function cacheVersion() {
  return TABLE_METADATA_CACHE_VERSION;
}

function metadataLoadKey(
  options: LoadTableMetadataOptions,
  generation: number,
) {
  const identity = resolveIdentity(options);
  return `${scopedTableCacheKey(identity)}:indexes:${
    options.includeIndexes !== false
  }:constraints:${options.includeConstraints !== false}:generation:${generation}`;
}

export function tableMetadataParentId(identity: TableMetadataIdentity) {
  return tableCacheKey(resolveIdentity(identity));
}

function tableMetadataResourceId(identity: TableMetadataIdentity) {
  return `${tableMetadataParentId(identity)}:${TABLE_METADATA_CACHE_KIND}`;
}

function parseCachedMetadata(
  resource: Resource | undefined,
  identity: ResolvedTableMetadataIdentity
): StoredTableMetadata | null {
  const metadata = resource?.metadata as Partial<StoredTableMetadata> | undefined;
  if (
    !metadata ||
    metadata.version !== cacheVersion() ||
    metadata.driver !== identity.driver ||
    (metadata.driverPackageVersion || null) !== identity.driverPackageVersion ||
    (metadata.connectionDatabaseName || null) !==
      identity.connectionDatabaseName ||
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
  identity: TableMetadataIdentity
): Promise<(StoredTableMetadata & { updatedAt: number }) | null> {
  const resolvedIdentity = resolveIdentity(identity);
  try {
    const resources = await storeService.getResources(
      resolvedIdentity.connectionId,
      tableMetadataParentId(resolvedIdentity),
      resolvedIdentity.projectId
    );
    const resource = resources.find(
      (item) => item.kind === TABLE_METADATA_CACHE_KIND
    );
    const metadata = parseCachedMetadata(resource, resolvedIdentity);
    return metadata
      ? { ...metadata, updatedAt: resource?.last_updated || 0 }
      : null;
  } catch {
    return null;
  }
}

async function persistTableMetadata(
  identity: TableMetadataIdentity,
  patch: Partial<StoredTableMetadata>,
  expectedGeneration: number,
): Promise<StoredTableMetadata> {
  const resolvedIdentity = resolveIdentity(identity);
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
        version: cacheVersion(),
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
        resolvedIdentity.projectId
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

function cachedSnapshot(
  cached: StoredTableMetadata & { updatedAt: number }
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
  const resolvedOptions = resolveIdentity(options);
  const scope = scopedTableCacheKey(resolvedOptions);
  const includeIndexes = options.includeIndexes !== false;
  const includeConstraints = options.includeConstraints !== false;
  const shouldLoadColumns = options.force || !Array.isArray(cached?.columns);
  const shouldLoadIndexes =
    includeIndexes && (options.force || !Array.isArray(cached?.indexes));
  const shouldLoadConstraints =
    includeConstraints &&
    (options.force || !Array.isArray(cached?.constraints));

  const columnsPromise = shouldLoadColumns
    ? resolvedOptions.databaseName
      ? schemaService.getDatabaseColumns(
          resolvedOptions.connectionId,
          resolvedOptions.databaseName,
          resolvedOptions.schema,
          resolvedOptions.table
        )
      : schemaService.getColumns(
          resolvedOptions.connectionId,
          resolvedOptions.schema,
          resolvedOptions.table
        )
    : Promise.resolve(cached?.columns || []);
  const indexesPromise = shouldLoadIndexes
    ? (resolvedOptions.databaseName
        ? schemaService.getDatabaseIndexes(
            resolvedOptions.connectionId,
            resolvedOptions.databaseName,
            resolvedOptions.schema,
            resolvedOptions.table
          )
        : schemaService.getIndexes(
            resolvedOptions.connectionId,
            resolvedOptions.schema,
            resolvedOptions.table
          )
      )
        .catch((error) => {
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
            resolvedOptions.table
          )
        : schemaService.getConstraints(
            resolvedOptions.connectionId,
            resolvedOptions.schema,
            resolvedOptions.table
          )
      )
        .catch((error) => {
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
  const updatedAt = Date.now();
  const patch: Partial<StoredTableMetadata> = {
    columns,
  };
  if (includeIndexes) patch.indexes = indexes;
  if (includeConstraints) patch.constraints = constraints;
  if (options.force) {
    patch.ddl = null;
    patch.viewDefinition = null;
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
  options: LoadTableMetadataOptions
): Promise<TableMetadataSnapshot> {
  const resolvedOptions = resolveIdentity(options);
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
        Array.isArray(cached?.constraints))
  );
  if (cached && cacheSatisfiesRequest) {
    return cachedSnapshot(cached);
  }

  const key = metadataLoadKey(resolvedOptions, request.generation);
  if (!options.force) {
    const pending = metadataLoads.get(key);
    if (pending) return pending;
  }

  const load = loadTableMetadataRemote(
    resolvedOptions,
    cached,
    request.generation,
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

export async function loadTableDdl(
  identity: TableMetadataIdentity,
  objectType?: string | null,
  force = false
): Promise<string> {
  const resolvedIdentity = resolveIdentity(identity);
  const request = force
    ? advanceCacheGeneration(resolvedIdentity)
    : captureCacheGeneration(resolvedIdentity);
  const cached = await readCachedTableMetadata(resolvedIdentity);
  cacheGenerations.assertCurrent(request.scope, request.generation);
  const normalizedObjectType = objectType || null;
  if (
    !force &&
    typeof cached?.ddl === "string" &&
    (cached.ddlObjectType || null) === normalizedObjectType
  ) {
    return cached.ddl;
  }

  const ddl = await tableService.getTableDdl(
    resolvedIdentity.connectionId,
    resolvedIdentity.driver,
    resolvedIdentity.schema,
    resolvedIdentity.table,
    objectType,
    resolvedIdentity.databaseName
  );
  cacheGenerations.assertCurrent(request.scope, request.generation);
  try {
    await persistTableMetadata(resolvedIdentity, {
      ddl,
      ddlObjectType: normalizedObjectType,
    }, request.generation);
  } catch (error) {
    if (isMetadataCacheSupersededError(error)) throw error;
    console.warn("Failed to persist table DDL cache", error);
  }
  cacheGenerations.assertCurrent(request.scope, request.generation);
  return ddl;
}

export async function loadViewDefinition(
  identity: TableMetadataIdentity,
  objectType?: string | null,
  force = false
): Promise<string> {
  const resolvedIdentity = resolveIdentity(identity);
  const request = force
    ? advanceCacheGeneration(resolvedIdentity)
    : captureCacheGeneration(resolvedIdentity);
  if (resolvedIdentity.databaseName) {
    throw new Error(
      `View definitions are unavailable for read-only database "${resolvedIdentity.databaseName}".`
    );
  }

  const cached = await readCachedTableMetadata(resolvedIdentity);
  cacheGenerations.assertCurrent(request.scope, request.generation);
  const normalizedObjectType = objectType || null;
  if (
    !force &&
    typeof cached?.viewDefinition === "string" &&
    (cached.viewObjectType || null) === normalizedObjectType
  ) {
    return cached.viewDefinition;
  }

  const definition = await tableService.getViewDefinition(
    resolvedIdentity.connectionId,
    resolvedIdentity.driver,
    resolvedIdentity.schema,
    resolvedIdentity.table,
    objectType
  );
  cacheGenerations.assertCurrent(request.scope, request.generation);
  try {
    await persistTableMetadata(resolvedIdentity, {
      viewDefinition: definition,
      viewObjectType: normalizedObjectType,
    }, request.generation);
  } catch (error) {
    if (isMetadataCacheSupersededError(error)) throw error;
    console.warn("Failed to persist view definition cache", error);
  }
  cacheGenerations.assertCurrent(request.scope, request.generation);
  return definition;
}

export async function invalidateTableMetadata(
  identity: TableMetadataIdentity
): Promise<void> {
  const resolvedIdentity = resolveIdentity(identity);
  const { scope } = advanceCacheGeneration(resolvedIdentity);
  const previousOperation = cacheOperations.get(scope) || Promise.resolve();
  const invalidation = previousOperation.catch(() => null).then(async () => {
    await storeService.deleteResources(
      resolvedIdentity.connectionId,
      tableMetadataParentId(resolvedIdentity),
      TABLE_METADATA_CACHE_KIND,
      resolvedIdentity.projectId
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
