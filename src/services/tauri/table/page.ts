import { invokeWithInterceptors } from "../client";
import type {
  DatabaseDriver,
  TableFilter,
  TablePageResult,
  TableSort,
} from "../types";

export async function previewTablePage(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  page = 0,
  pageSize = 500,
  filterSql?: string,
  filters?: TableFilter[],
  sort?: TableSort,
  databaseName?: string,
  includeTotal = false,
): Promise<TablePageResult> {
  return invokeWithInterceptors<TablePageResult>("preview_table_page", {
    connectionId,
    driver,
    schema,
    table,
    page,
    pageSize,
    filterSql,
    filters,
    sort,
    database: databaseName,
    includeTotal,
  });
}

export async function truncateTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
): Promise<string> {
  return invokeWithInterceptors<string>("truncate_table", {
    connectionId,
    driver,
    schema,
    table,
  });
}

export async function dropTable(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  table: string,
  cascade = false,
  objectType?: string | null,
): Promise<string> {
  return invokeWithInterceptors<string>("drop_table", {
    connectionId,
    driver,
    schema,
    table,
    cascade,
    objectType,
  });
}

export const tablePageService = {
  previewTablePage,
  truncateTable,
  dropTable,
};
