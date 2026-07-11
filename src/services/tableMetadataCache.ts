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

export interface TableMetadataIdentity {
  connectionId: string;
  driver: DatabaseDriver;
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
  driver: DatabaseDriver;
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

function tableCacheKey(identity: TableMetadataIdentity) {
  return [
    identity.connectionId,
    identity.driver,
    identity.schema,
    identity.table,
  ].join(":");
}

function metadataLoadKey(options: LoadTableMetadataOptions) {
  return `${tableCacheKey(options)}:indexes:${
    options.includeIndexes !== false
  }:constraints:${options.includeConstraints !== false}`;
}

export function tableMetadataParentId(identity: TableMetadataIdentity) {
  return tableCacheKey(identity);
}

function tableMetadataResourceId(identity: TableMetadataIdentity) {
  return `${tableMetadataParentId(identity)}:${TABLE_METADATA_CACHE_KIND}`;
}

function parseCachedMetadata(
  resource: Resource | undefined,
  identity: TableMetadataIdentity
): StoredTableMetadata | null {
  const metadata = resource?.metadata as Partial<StoredTableMetadata> | undefined;
  if (
    !metadata ||
    metadata.version !== TABLE_METADATA_CACHE_VERSION ||
    metadata.driver !== identity.driver ||
    metadata.schema !== identity.schema ||
    metadata.table !== identity.table
  ) {
    return null;
  }

  return metadata as StoredTableMetadata;
}

export async function readCachedTableMetadata(
  identity: TableMetadataIdentity
): Promise<(StoredTableMetadata & { updatedAt: number }) | null> {
  try {
    const resources = await storeService.getResources(
      identity.connectionId,
      tableMetadataParentId(identity)
    );
    const resource = resources.find(
      (item) => item.kind === TABLE_METADATA_CACHE_KIND
    );
    const metadata = parseCachedMetadata(resource, identity);
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
  const key = tableCacheKey(identity);
  const previousWrite = cacheWrites.get(key) || Promise.resolve(null);
  const nextWrite = previousWrite
    .catch(() => null)
    .then(async () => {
      const current = await readCachedTableMetadata(identity);
      const metadata: StoredTableMetadata = {
        version: TABLE_METADATA_CACHE_VERSION,
        driver: identity.driver,
        schema: identity.schema,
        table: identity.table,
        ...(current || {}),
        ...patch,
      };
      delete (metadata as Partial<StoredTableMetadata> & { updatedAt?: number })
        .updatedAt;

      await storeService.saveResources([
        {
          id: tableMetadataResourceId(identity),
          connection_id: identity.connectionId,
          parent_id: tableMetadataParentId(identity),
          kind: TABLE_METADATA_CACHE_KIND,
          name: identity.table,
          metadata,
          last_updated: Date.now(),
        },
      ]);
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
  const includeIndexes = options.includeIndexes !== false;
  const includeConstraints = options.includeConstraints !== false;
  const shouldLoadColumns = options.force || !Array.isArray(cached?.columns);
  const shouldLoadIndexes =
    includeIndexes && (options.force || !Array.isArray(cached?.indexes));
  const shouldLoadConstraints =
    includeConstraints &&
    (options.force || !Array.isArray(cached?.constraints));

  const columnsPromise = shouldLoadColumns
    ? schemaService.getColumns(
        options.connectionId,
        options.schema,
        options.table
      )
    : Promise.resolve(cached?.columns || []);
  const indexesPromise = shouldLoadIndexes
    ? schemaService
        .getIndexes(options.connectionId, options.schema, options.table)
        .catch((error) => {
          console.warn("Failed to refresh cached table indexes", error);
          return cached?.indexes || [];
        })
    : Promise.resolve(cached?.indexes || []);
  const constraintsPromise = shouldLoadConstraints
    ? schemaService
        .getConstraints(options.connectionId, options.schema, options.table)
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
    await persistTableMetadata(options, patch);
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
  const cached = await readCachedTableMetadata(options);
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

  const key = metadataLoadKey(options);
  if (!options.force) {
    const pending = metadataLoads.get(key);
    if (pending) return pending;
  }

  const load = loadTableMetadataRemote(options, cached);
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
  const cached = await readCachedTableMetadata(identity);
  const normalizedObjectType = objectType || null;
  if (
    !force &&
    typeof cached?.ddl === "string" &&
    (cached.ddlObjectType || null) === normalizedObjectType
  ) {
    return cached.ddl;
  }

  const ddl = await tableService.getTableDdl(
    identity.connectionId,
    identity.driver,
    identity.schema,
    identity.table,
    objectType
  );
  try {
    await persistTableMetadata(identity, {
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
  const cached = await readCachedTableMetadata(identity);
  const normalizedObjectType = objectType || null;
  if (
    !force &&
    typeof cached?.viewDefinition === "string" &&
    (cached.viewObjectType || null) === normalizedObjectType
  ) {
    return cached.viewDefinition;
  }

  const definition = await tableService.getViewDefinition(
    identity.connectionId,
    identity.driver,
    identity.schema,
    identity.table,
    objectType
  );
  try {
    await persistTableMetadata(identity, {
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
  try {
    await storeService.deleteResources(
      identity.connectionId,
      tableMetadataParentId(identity),
      TABLE_METADATA_CACHE_KIND
    );
  } catch (error) {
    console.warn("Failed to invalidate table metadata cache", error);
  }
}
