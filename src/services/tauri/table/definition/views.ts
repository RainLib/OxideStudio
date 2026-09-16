import { invokeWithInterceptors } from "../../client";
import type {
  CreateMaterializedViewResult,
  CreateViewResult,
  DatabaseDriver,
} from "../../types";

export async function createView(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  selectSql: string,
  replace = false,
): Promise<CreateViewResult> {
  return invokeWithInterceptors<CreateViewResult>("create_view", {
    connectionId,
    driver,
    schema,
    view,
    selectSql,
    replace,
  });
}

export async function createMaterializedView(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  selectSql: string,
  withData = true,
): Promise<CreateMaterializedViewResult> {
  return invokeWithInterceptors<CreateMaterializedViewResult>(
    "create_materialized_view",
    {
      connectionId,
      driver,
      schema,
      view,
      selectSql,
      withData,
    },
  );
}

export async function refreshMaterializedView(
  connectionId: string,
  driver: DatabaseDriver,
  schema: string,
  view: string,
  objectType?: string | null,
  concurrently = false,
): Promise<string> {
  return invokeWithInterceptors<string>("refresh_materialized_view", {
    connectionId,
    driver,
    schema,
    view,
    objectType,
    concurrently,
  });
}

export const tableDefinitionViewService = {
  createView,
  createMaterializedView,
  refreshMaterializedView,
};
