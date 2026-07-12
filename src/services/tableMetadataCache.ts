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

const TABLE_METADATA_CACHE_KIND = "TABLE_METADATA_CACHE";
const TABLE_METADATA_CACHE_VERSION = 1;
const DATABASE_SCOPED_TABLE_METADATA_CACHE_VERSION = 2;
const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";
const DEFAULT_PROJECT_ID = "sqls";

export interface TableMetadataIdentity {
  projectId?: string;
  connectionId: string;
  driver: DatabaseDriver;
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
const cacheWrites = new Map<string, Promise<StoredTableMetadata>>();

type ResolvedTableMetadataIdentity = TableMetadataIdentity & {
  projectId: string;
};

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
    ...identity,
    projectId: identity.projectId || activeProjectId(),
    databaseName: identity.databaseName || undefined,
  };
}

function legacyTableCacheKey(identity: TableMetadataIdentity) {
  return [
    identity.connectionId,
    identity.driver,
    identity.schema,
    identity.table,
  ].join(":");
}

function tableCacheKey(identity: ResolvedTableMetadataIdentity) {
  if (!identity.databaseName) return legacyTableCacheKey(identity);

  return `oxide:table-metadata:v2:${encodeURIComponent(
    JSON.stringify([
      identity.projectId,
      identity.connectionId,
      identity.driver,
      identity.databaseName,
      identity.schema,
      identity.table,
    ])
  )}`;
}

function scopedTableCacheKey(identity: ResolvedTableMetadataIdentity) {
  return `${encodeURIComponent(identity.projectId)}:${tableCacheKey(identity)}`;
}

function cacheVersion(identity: TableMetadataIdentity) {
  return identity.databaseName
    ? DATABASE_SCOPED_TABLE_METADATA_CACHE_VERSION
    : TABLE_METADATA_CACHE_VERSION;
}

function metadataLoadKey(options: LoadTableMetadataOptions) {
  const identity = resolveIdentity(options);
  return `${scopedTableCacheKey(identity)}:indexes:${
    options.includeIndexes !== false
  }:constraints:${options.includeConstraints !== false}`;
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
    metadata.version !== cacheVersion(identity) ||
    metadata.driver !== identity.driver ||
    (metadata.databaseName || undefined) !== identity.databaseName ||
    metadata.schema !== identity.schema ||
    metadata.table !== identity.table ||
    (identity.databaseName &&
      (metadata.projectId !== identity.projectId ||
        resource?.project_id !== identity.projectId))
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
  patch: Partial<StoredTableMetadata>
): Promise<StoredTableMetadata> {
  const resolvedIdentity = resolveIdentity(identity);
  const key = scopedTableCacheKey(resolvedIdentity);
  const previousWrite = cacheWrites.get(key) || Promise.resolve(null);
  const nextWrite = previousWrite
    .catch(() => null)
    .then(async () => {
      const current = await readCachedTableMetadata(resolvedIdentity);
      const metadata: StoredTableMetadata = {
        ...(current || {}),
        version: cacheVersion(resolvedIdentity),
        projectId: resolvedIdentity.projectId,
        driver: resolvedIdentity.driver,
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

  cacheWrites.set(key, nextWrite);
  try {
    return await nextWrite;
  } finally {
    if (cacheWrites.get(key) === nextWrite) {
      cacheWrites.delete(key);
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
  cached: (StoredTableMetadata & { updatedAt: number }) | null
): Promise<TableMetadataSnapshot> {
  const resolvedOptions = resolveIdentity(options);
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
    await persistTableMetadata(resolvedOptions, patch);
  } catch (error) {
    console.warn("Failed to persist table metadata cache", error);
  }

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
  const cached = await readCachedTableMetadata(resolvedOptions);
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

  const key = metadataLoadKey(resolvedOptions);
  if (!options.force) {
    const pending = metadataLoads.get(key);
    if (pending) return pending;
  }

  const load = loadTableMetadataRemote(resolvedOptions, cached);
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
  const cached = await readCachedTableMetadata(resolvedIdentity);
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
  try {
    await persistTableMetadata(resolvedIdentity, {
      ddl,
      ddlObjectType: normalizedObjectType,
    });
  } catch (error) {
    console.warn("Failed to persist table DDL cache", error);
  }
  return ddl;
}

export async function loadViewDefinition(
  identity: TableMetadataIdentity,
  objectType?: string | null,
  force = false
): Promise<string> {
  const resolvedIdentity = resolveIdentity(identity);
  if (resolvedIdentity.databaseName) {
    throw new Error(
      `View definitions are unavailable for read-only database "${resolvedIdentity.databaseName}".`
    );
  }

  const cached = await readCachedTableMetadata(resolvedIdentity);
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
  try {
    await persistTableMetadata(resolvedIdentity, {
      viewDefinition: definition,
      viewObjectType: normalizedObjectType,
    });
  } catch (error) {
    console.warn("Failed to persist view definition cache", error);
  }
  return definition;
}

export async function invalidateTableMetadata(
  identity: TableMetadataIdentity
): Promise<void> {
  const resolvedIdentity = resolveIdentity(identity);
  try {
    await storeService.deleteResources(
      resolvedIdentity.connectionId,
      tableMetadataParentId(resolvedIdentity),
      TABLE_METADATA_CACHE_KIND,
      resolvedIdentity.projectId
    );
  } catch (error) {
    console.warn("Failed to invalidate table metadata cache", error);
  }
}
