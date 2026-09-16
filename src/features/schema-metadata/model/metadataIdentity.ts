export const LEGACY_STORAGE_KEY = "oxide-studio-default-schema";

export const ACTIVE_PROJECT_KEY = "oxide-studio-active-project";

export const DEFAULT_PROJECT_ID = "sqls";

export const getActiveProjectId = () =>
  readStorageItem(ACTIVE_PROJECT_KEY) || DEFAULT_PROJECT_ID;

export const projectScopedKey = (...parts: Array<string | null | undefined>) =>
  [getActiveProjectId(), ...parts.map((part) => part || "unknown")].join(":");

export const getDefaultSchemaKey = (
  connId: string,
  driver: string | null | undefined,
) => `oxide-studio-default-schema:${projectScopedKey(connId, driver)}`;

export const getPinnedTablesKey = (
  connId: string,
  schema: string,
  driver: string | null | undefined,
) => `oxide-studio-pinned-tables:${projectScopedKey(connId, driver, schema)}`;

export const getSchemaResourceId = (
  connectionId: string,
  schema: string,
  driver: string | null | undefined,
) => `${connectionId}:${driver || "unknown"}:${schema}`;

export const getConnectionSnapshotKey = (
  connectionId: string,
  driver: string | null | undefined,
) => projectScopedKey(connectionId, driver);

export const getObjectSnapshotKey = (
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
) => projectScopedKey(connectionId, driver, schema);

export const getLoadKey = (
  connectionId: string,
  driver: string | null | undefined,
) => projectScopedKey(connectionId, driver);

export const getObjectLoadKey = (
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
  kind: string,
) => projectScopedKey(connectionId, driver, schema, kind);

export const getConnectionMetadataSnapshotKey = getConnectionSnapshotKey;

export const getSchemaObjectMetadataSnapshotKey = getObjectSnapshotKey;

export const getConnectionMetadataNodeKey = (
  connectionId: string,
  driver: string | null | undefined,
) => `connection:${getLoadKey(connectionId, driver)}`;

export const getSchemaMetadataNodeKey = (
  connectionId: string,
  driver: string | null | undefined,
  schema: string,
) => `schema:${getObjectLoadKey(connectionId, driver, schema, "tables")}`;

export const getSavedDefaultSchema = (
  connectionId: string,
  driver: string | null | undefined,
) =>
  readStorageItem(getDefaultSchemaKey(connectionId, driver)) ||
  (getActiveProjectId() === DEFAULT_PROJECT_ID
    ? readStorageItem(LEGACY_STORAGE_KEY)
    : null);

export function readStorageItem(key: string) {
  try {
    return typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(key);
  } catch (error) {
    console.warn("Store: Failed to read localStorage", error);
    return null;
  }
}

export function writeStorageItem(key: string, value: string) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn("Store: Failed to write localStorage", error);
  }
}

export const readPinnedTables = (
  connectionId: string,
  schema: string,
  driver: string | null | undefined,
) => {
  try {
    const parsedPins = JSON.parse(
      readStorageItem(getPinnedTablesKey(connectionId, schema, driver)) || "[]",
    );
    return Array.isArray(parsedPins)
      ? parsedPins.filter((value): value is string => typeof value === "string")
      : [];
  } catch (error) {
    console.warn("Store: Failed to read pinned tables", error);
    return [];
  }
};
