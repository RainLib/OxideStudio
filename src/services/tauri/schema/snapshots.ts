import { invokeWithInterceptors } from "../client";
import type {
  ExecuteSchemaMigrationRequest,
  SchemaDiffPlan,
  SchemaMigrationJournalEntry,
  SchemaSnapshot,
  TableInfo,
} from "../types";

export async function captureSchemaSnapshot(options: {
  projectId: string;
  connectionId: string;
  connectionName: string;
  driver: string;
  database?: string | null;
  schema: string;
  allowPartial?: boolean;
}): Promise<SchemaSnapshot> {
  return invokeWithInterceptors<SchemaSnapshot>("capture_schema_snapshot", {
    projectId: options.projectId,
    connectionId: options.connectionId,
    connectionName: options.connectionName,
    driver: options.driver,
    database: options.database || null,
    schema: options.schema,
    allowPartial: options.allowPartial || false,
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

export async function executeSchemaMigration(
  request: ExecuteSchemaMigrationRequest,
): Promise<SchemaMigrationJournalEntry> {
  return invokeWithInterceptors<SchemaMigrationJournalEntry>(
    "execute_schema_migration",
    { request },
  );
}

export async function listSchemaMigrationJournal(
  projectId: string,
  connectionId: string,
  limit = 20,
): Promise<SchemaMigrationJournalEntry[]> {
  return invokeWithInterceptors<SchemaMigrationJournalEntry[]>(
    "list_schema_migration_journal",
    { projectId, connectionId, limit },
  );
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
