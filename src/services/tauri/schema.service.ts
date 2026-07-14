import { invokeWithInterceptors } from "./client";
import type {
  TableInfo,
  CollectionInfo,
  CollectionPage,
  ColumnInfo,
  ConstraintInfo,
  ForeignKeyReferenceInfo,
  FunctionInfo,
  IndexInfo,
  SchemaDiffPlan,
  SchemaSnapshot,
} from "./types";

/**
 * Get databases visible from the connected server.
 * PostgreSQL databases are intentionally separate from schemas.
 */
export async function getDatabases(connectionId: string): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_databases", {
    connectionId,
  });
}

/**
 * Schema 和表结构服务
 * 管理数据库 schema、表和列的元数据
 */

/**
 * 获取所有 schema 列表
 * @param connectionId - 连接 ID
 * @returns Promise<string[]> - schema 名称列表
 */
export async function getSchemas(connectionId: string): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_schemas", {
    connectionId,
  });
}

/**
 * Get schemas from an explicitly selected server database. This is read-only
 * metadata discovery and does not change the active query database.
 */
export async function getDatabaseSchemas(
  connectionId: string,
  database: string
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_database_schemas", {
    connectionId,
    database,
  });
}

/**
 * 获取指定 schema 下的表列表
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<TableInfo[]> - 表信息列表
 */
export async function getTables(
  connectionId: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("get_tables", {
    connectionId,
    schema,
  });
}

export async function getCollections(
  connectionId: string,
  namespace: string
): Promise<CollectionInfo[]> {
  return invokeWithInterceptors<CollectionInfo[]>("get_collections", {
    connectionId,
    namespace,
  });
}

export async function getCollectionsPage(
  connectionId: string,
  namespace: string,
  cursor?: string | null,
  limit = 100,
  filter?: string | null
): Promise<CollectionPage> {
  return invokeWithInterceptors<CollectionPage>("get_collections_page", {
    connectionId,
    namespace,
    cursor: cursor || null,
    limit,
    filter: filter || null,
  });
}

export async function getDatabaseTables(
  connectionId: string,
  database: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("get_database_tables", {
    connectionId,
    database,
    schema,
  });
}

/**
 * 获取指定表的列信息
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @param table - 表名称
 * @returns Promise<ColumnInfo[]> - 列信息列表
 */
export async function getColumns(
  connectionId: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return invokeWithInterceptors<ColumnInfo[]>("get_columns", {
    connectionId,
    schema,
    table,
  });
}

export async function getDatabaseColumns(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ColumnInfo[]> {
  return invokeWithInterceptors<ColumnInfo[]>("get_database_columns", {
    connectionId,
    database,
    schema,
    table,
  });
}

export async function getIndexes(
  connectionId: string,
  schema: string,
  table: string
): Promise<IndexInfo[]> {
  return invokeWithInterceptors<IndexInfo[]>("get_indexes", {
    connectionId,
    schema,
    table,
  });
}

export async function getDatabaseIndexes(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<IndexInfo[]> {
  return invokeWithInterceptors<IndexInfo[]>("get_database_indexes", {
    connectionId,
    database,
    schema,
    table,
  });
}

export async function getConstraints(
  connectionId: string,
  schema: string,
  table: string
): Promise<ConstraintInfo[]> {
  return invokeWithInterceptors<ConstraintInfo[]>("get_constraints", {
    connectionId,
    schema,
    table,
  });
}

export async function getFunctions(
  connectionId: string,
  schema: string
): Promise<FunctionInfo[]> {
  return invokeWithInterceptors<FunctionInfo[]>("get_functions", {
    connectionId,
    schema,
  });
}

export async function getDatabaseConstraints(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ConstraintInfo[]> {
  return invokeWithInterceptors<ConstraintInfo[]>(
    "get_database_constraints",
    {
      connectionId,
      database,
      schema,
      table,
    }
  );
}

export async function getReferencingForeignKeys(
  connectionId: string,
  schema: string,
  table: string
): Promise<ForeignKeyReferenceInfo[]> {
  return invokeWithInterceptors<ForeignKeyReferenceInfo[]>(
    "get_referencing_foreign_keys",
    { connectionId, schema, table }
  );
}

export async function getDatabaseReferencingForeignKeys(
  connectionId: string,
  database: string,
  schema: string,
  table: string
): Promise<ForeignKeyReferenceInfo[]> {
  return invokeWithInterceptors<ForeignKeyReferenceInfo[]>(
    "get_database_referencing_foreign_keys",
    { connectionId, database, schema, table }
  );
}

export async function getDatabaseFunctions(
  connectionId: string,
  database: string,
  schema: string
): Promise<FunctionInfo[]> {
  return invokeWithInterceptors<FunctionInfo[]>("get_database_functions", {
    connectionId,
    database,
    schema,
  });
}

/**
 * 设置当前 schema
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<string> - 设置成功消息
 */
export async function setCurrentSchema(
  connectionId: string,
  schema: string
): Promise<string> {
  return invokeWithInterceptors<string>("set_current_schema", {
    connectionId,
    schema,
  });
}

export async function captureSchemaSnapshot(options: {
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: string;
  database?: string | null;
  schema: string;
}): Promise<SchemaSnapshot> {
  return invokeWithInterceptors<SchemaSnapshot>("capture_schema_snapshot", {
    projectId: options.projectId,
    connectionId: options.connectionId,
    connectionName: options.connectionName,
    driver: options.driver,
    database: options.database || null,
    schema: options.schema,
  });
}

export async function compareSchemaSnapshots(
  source: SchemaSnapshot,
  target: SchemaSnapshot,
): Promise<SchemaDiffPlan> {
  return invokeWithInterceptors<SchemaDiffPlan>("compare_schema_snapshots", {
    source,
    target,
  });
}

/**
 * 获取缓存的 schema 列表
 * @param connectionId - 连接 ID
 * @returns Promise<string[]> - 缓存的 schema 列表
 */
export async function getCachedSchemas(
  connectionId: string
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_cached_schemas", {
    connectionId,
  });
}

/**
 * 刷新 schema 列表
 * @param connectionId - 连接 ID
 * @returns Promise<string[]> - 刷新后的 schema 列表
 */
export async function refreshSchemas(connectionId: string): Promise<string[]> {
  return invokeWithInterceptors<string[]>("refresh_schemas", {
    connectionId,
  });
}

/**
 * 获取缓存的表列表
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<TableInfo[]> - 缓存的表列表
 */
export async function getCachedTables(
  connectionId: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("get_cached_tables", {
    connectionId,
    schema,
  });
}

/**
 * 刷新表列表
 * @param connectionId - 连接 ID
 * @param schema - schema 名称
 * @returns Promise<TableInfo[]> - 刷新后的表列表
 */
export async function refreshTables(
  connectionId: string,
  schema: string
): Promise<TableInfo[]> {
  return invokeWithInterceptors<TableInfo[]>("refresh_tables", {
    connectionId,
    schema,
  });
}

/**
 * Schema 服务对象
 */
export const schemaService = {
  getDatabases,
  getSchemas,
  getDatabaseSchemas,
  getTables,
  getDatabaseTables,
  getCollections,
  getCollectionsPage,
  getColumns,
  getDatabaseColumns,
  getIndexes,
  getDatabaseIndexes,
  getConstraints,
  getDatabaseConstraints,
  getReferencingForeignKeys,
  getDatabaseReferencingForeignKeys,
  getFunctions,
  getDatabaseFunctions,
  setCurrentSchema,
  captureSchemaSnapshot,
  compareSchemaSnapshots,
  getCachedSchemas,
  refreshSchemas,
  getCachedTables,
  refreshTables,
};
