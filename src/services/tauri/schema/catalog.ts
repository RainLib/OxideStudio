import { invokeWithInterceptors } from "../client";
import type {
  CollectionInfo,
  CollectionPage,
  ColumnInfo,
  DatabaseInfo,
  SchemaObjectInfo,
  TableInfo,
} from "../types";

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

/**
 * Get database names plus optional product metadata for the workspace browser.
 * Drivers without metadata support return name-only rows.
 */
export async function getDatabaseMetadata(
  connectionId: string,
): Promise<DatabaseInfo[]> {
  return invokeWithInterceptors<DatabaseInfo[]>("get_database_metadata", {
    connectionId,
  });
}

/**
 * Read-only non-relation object descriptors from an explicitly selected
 * database. This does not alter the active query database.
 */
export async function getDatabaseSchemaObjects(
  connectionId: string,
  database: string,
  schema: string,
): Promise<SchemaObjectInfo[]> {
  return invokeWithInterceptors<SchemaObjectInfo[]>(
    "get_database_schema_objects",
    { connectionId, database, schema },
  );
}

/** Descriptor-only schema objects (for example PostgreSQL sequences/triggers). */
export async function getSchemaObjects(
  connectionId: string,
  schema: string,
): Promise<SchemaObjectInfo[]> {
  return invokeWithInterceptors<SchemaObjectInfo[]>("get_schema_objects", {
    connectionId,
    schema,
  });
}

/** Read-only children of a descriptor the driver marked as expandable. */
export async function getSchemaObjectMembers(
  connectionId: string,
  schema: string,
  objectName: string,
  objectType: string,
): Promise<SchemaObjectInfo[]> {
  return invokeWithInterceptors<SchemaObjectInfo[]>(
    "get_schema_object_members",
    { connectionId, schema, objectName, objectType },
  );
}

/** Driver-owned, read-only source definitions for one descriptor object. */
export async function getSchemaObjectSource(
  connectionId: string,
  schema: string,
  objectName: string,
  objectType: string,
  relationName?: string | null,
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_schema_object_source", {
    connectionId,
    schema,
    objectName,
    objectType,
    relationName: relationName || null,
  });
}

/** Database-scoped descriptor members without changing the active database. */
export async function getDatabaseSchemaObjectMembers(
  connectionId: string,
  database: string,
  schema: string,
  objectName: string,
  objectType: string,
): Promise<SchemaObjectInfo[]> {
  return invokeWithInterceptors<SchemaObjectInfo[]>(
    "get_database_schema_object_members",
    { connectionId, database, schema, objectName, objectType },
  );
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
