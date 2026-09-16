import { invokeWithInterceptors } from "../../client";
import type { DatabaseDriver } from "../../types";

export async function getTableDdl(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  objectType?: string | null,
  databaseName?: string,
): Promise<string> {
  return invokeWithInterceptors<string>("get_table_ddl", {
    connectionId,
    driver,
    schema,
    table,
    objectType,
    database: databaseName,
  });
}

export async function getViewDefinition(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  objectType?: string | null,
): Promise<string> {
  return invokeWithInterceptors<string>("get_view_definition", {
    connectionId,
    driver,
    schema,
    view,
    objectType,
  });
}

/** PostgreSQL-only, bounded source definitions. Multiple overloads may match. */
export async function getPostgresRoutineDefinitions(
  connectionId: string,
  schema: string,
  routine: string,
): Promise<string[]> {
  return invokeWithInterceptors<string[]>("get_postgres_routine_definitions", {
    connectionId,
    schema,
    routine,
  });
}

export const tableDefinitionSourceService = {
  getTableDdl,
  getViewDefinition,
  getPostgresRoutineDefinitions,
};
