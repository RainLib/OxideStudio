import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import type {
  CollectionInfo,
  DatabaseDriver,
  FunctionInfo,
  NacosConfigLocation,
} from "@/services/tauri/types";
import { type CSSProperties } from "react";

export function nacosLocationFromCollection(
  collection: CollectionInfo,
): NacosConfigLocation | null {
  try {
    const key = JSON.parse(collection.name) as {
      dataId?: unknown;
      group?: unknown;
      tenant?: unknown;
    };
    if (
      typeof key.dataId !== "string" ||
      !key.dataId.trim() ||
      typeof key.group !== "string" ||
      !key.group.trim() ||
      (key.tenant !== undefined && typeof key.tenant !== "string")
    ) {
      return null;
    }
    return { dataId: key.dataId, group: key.group, tenant: key.tenant || "" };
  } catch {
    return null;
  }
}

export function routineMatchesFilter(
  routine: FunctionInfo,
  matches: (...values: Array<unknown>) => boolean,
) {
  return matches(
    routine.name,
    routine.routine_type,
    routine.return_type,
    routine.description,
    ...(routine.parameters || []).flatMap((parameter) => [
      parameter.name,
      parameter.data_type,
    ]),
  );
}

export function parseExplorerVisibilityPatterns(value: string) {
  return value
    .split(/[\n,;]+/u)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

export const DRIVER_TREE_COLORS: Record<string, string> = {
  postgres: "#5b8dd6",
  mysql: "#d9904f",
  mariadb: "#c0765a",
  redis: "#d95b5b",
  elasticsearch: "#d6ad5b",
  mongodb: "#5fb878",
};

export function connectionTreeColor(
  driver: string | null | undefined,
  color?: string,
) {
  return color || DRIVER_TREE_COLORS[driver || ""] || "#75a7ff";
}

export function supportsDatabaseCatalogTree(
  driver: DatabaseDriver | null | undefined,
) {
  return Boolean(
    driver && defaultDatabaseCapabilities(driver).supportsDatabaseCatalogs,
  );
}

export function supportsDatabaseAdministration(
  driver: DatabaseDriver | null | undefined,
) {
  return driver === "postgres" || driver === "mysql" || driver === "mariadb";
}

export function connectionRegionStyle(
  color: string | undefined,
  active: boolean,
): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--connection-color": color,
    backgroundColor: `${color}${active ? "18" : "0b"}`,
    borderColor: active ? `${color}35` : "transparent",
  } as CSSProperties;
}

export function schemaTreeKey(
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
) {
  return `${connectionId}:${driver || "unknown"}:${schema}`;
}

export function objectGroupKey(
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
  group: string,
) {
  return `${connectionId}:${driver || "unknown"}:${schema}:${group}`;
}

export function tableTreeKey(
  connectionId: string,
  driver: string | null | undefined,
  databaseName: string | undefined,
  schema: string,
  table: string,
) {
  return JSON.stringify([
    connectionId,
    driver || "unknown",
    databaseName || "",
    schema,
    table,
  ]);
}

export function isEditableExplorerShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}
