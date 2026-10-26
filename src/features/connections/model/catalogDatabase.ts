import { parseConnectionUrl } from "@/lib/connectionUrlParser";
import {
  defaultDatabaseName,
  isFileBasedDatabaseDriver,
} from "@/lib/databaseDialect";
import type { DatabaseDriver } from "@/services/tauri/types";
import type { ManagedDataSourceDescriptor } from "@/services/tauri/enterprise.service";

/** Permission summaries are resource paths, never connection database names. */
export function managedCatalogDatabaseName(
  descriptor: Pick<ManagedDataSourceDescriptor, "allowedResourceSummary">,
) {
  const catalogs = new Set(
    descriptor.allowedResourceSummary.map((path) => path.split("/")[0]?.trim()),
  );
  if (catalogs.size !== 1) return "";
  const catalog = [...catalogs][0];
  return catalog && !catalog.includes("*") ? catalog : "";
}

/**
 * Resolve the configured server catalog using the same URL precedence as the
 * connection form. The component retains its historical PostgreSQL filename,
 * but external JDBC catalog providers use the same Explorer tree and must not
 * lose their current database context.
 */
export function connectionCatalogDatabaseName(connection: {
  driver?: DatabaseDriver;
  database?: string;
  connectionUrl?: string;
  url?: string;
  origin?: "local" | "managed";
  managedDescriptor?: ManagedDataSourceDescriptor;
}) {
  const driver = connection.driver || "postgres";
  if (connection.origin === "managed") {
    return connection.managedDescriptor
      ? managedCatalogDatabaseName(connection.managedDescriptor)
      : "";
  }
  // File-backed engines discover attached catalogs at runtime. Their
  // connection `database` is a file path, not a catalog name.
  if (isFileBasedDatabaseDriver(driver)) return "";
  // The connection store gives an explicit connection URL precedence over
  // individual form fields, so the Explorer must resolve the database in the
  // same order or schemas can appear under the wrong node.
  const explicitUrl = parseConnectionUrl(
    connection.connectionUrl || "",
    driver,
  );
  if (explicitUrl?.database) {
    try {
      return decodeURIComponent(explicitUrl.database);
    } catch {
      return explicitUrl.database;
    }
  }

  if (connection.database) return connection.database;

  const legacyUrl = parseConnectionUrl(connection.url || "", driver);
  if (legacyUrl?.database) {
    try {
      return decodeURIComponent(legacyUrl.database);
    } catch {
      return legacyUrl.database;
    }
  }

  return defaultDatabaseName(driver) || "";
}
