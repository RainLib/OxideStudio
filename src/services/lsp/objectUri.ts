export const LSP_DATABASE_OBJECT_URI_HOST = "database-object";

export type LspDatabaseObjectUriTarget = {
  connectionId: string;
  databaseName?: string | null;
  schemaName: string;
  objectName?: string | null;
  objectType?: string | null;
  columnName?: string | null;
};

/**
 * Stable application-owned URI used by the bundled LSP for database metadata.
 *
 * The URI is navigation-only: it never contains credentials, connection URLs,
 * or DDL text. Monaco can hand it back to Database Explorer instead of opening
 * a fake schema.sql model.
 */
export function getLspDatabaseObjectUri(
  target: LspDatabaseObjectUriTarget
): string {
  const url = new URL(`oxide://${LSP_DATABASE_OBJECT_URI_HOST}/object`);
  url.searchParams.set("connection", target.connectionId);
  url.searchParams.set("schema", target.schemaName);
  if (target.databaseName) url.searchParams.set("database", target.databaseName);
  if (target.objectName) url.searchParams.set("object", target.objectName);
  if (target.objectType) url.searchParams.set("type", target.objectType);
  if (target.columnName) url.searchParams.set("column", target.columnName);
  return url.toString();
}

export function parseLspDatabaseObjectUri(
  uri: string
): LspDatabaseObjectUriTarget | null {
  try {
    const url = new URL(uri);
    if (
      url.protocol !== "oxide:" ||
      url.hostname !== LSP_DATABASE_OBJECT_URI_HOST
    ) {
      return null;
    }

    const connectionId = url.searchParams.get("connection")?.trim();
    const schemaName = url.searchParams.get("schema")?.trim();
    if (!connectionId || !schemaName) return null;

    return {
      connectionId,
      schemaName,
      databaseName: optionalParam(url, "database"),
      objectName: optionalParam(url, "object"),
      objectType: optionalParam(url, "type"),
      columnName: optionalParam(url, "column"),
    };
  } catch {
    return null;
  }
}

function optionalParam(url: URL, key: string) {
  const value = url.searchParams.get(key)?.trim();
  return value || undefined;
}
