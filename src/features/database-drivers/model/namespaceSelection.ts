import { normalizeDatabaseDriverName } from "@/features/database-drivers/model/runtimeCatalog";
import type { DatabaseDriver } from "@/services/tauri/types";

export function pluralizeNamespaceLabel(label: string | null | undefined) {
  const normalized = (label || "namespace").trim().toLowerCase();
  if (normalized === "schema") return "schemas";
  if (normalized === "database") return "databases";
  if (normalized.endsWith("s")) return `${normalized}es`;
  if (normalized.endsWith("y")) return `${normalized.slice(0, -1)}ies`;
  return `${normalized}s`;
}

export function isSystemNamespace(
  driver: DatabaseDriver | null | undefined,
  namespace: string | null | undefined,
) {
  const normalizedDriver =
    normalizeDatabaseDriverName(String(driver || "")) || driver;
  const normalized = (namespace || "").trim().toLowerCase();
  if (!normalized) return false;

  if (normalizedDriver === "mysql") {
    return [
      "information_schema",
      "mysql",
      "performance_schema",
      "sys",
    ].includes(normalized);
  }

  if (normalizedDriver === "postgres") {
    return (
      normalized === "information_schema" ||
      normalized === "pg_catalog" ||
      normalized === "pg_toast" ||
      normalized.startsWith("pg_temp_") ||
      normalized.startsWith("pg_toast_temp_")
    );
  }

  if (normalizedDriver === "sqlserver") {
    return normalized === "information_schema" || normalized === "sys";
  }

  return false;
}

/**
 * Some products use the saved connection database as their Explorer
 * namespace (for example MySQL and MongoDB), while SQL Server keeps catalog
 * and schema as separate levels. Do not let a catalog that happens to share a
 * schema name displace SQL Server's real default schema.
 */
export function connectionDatabaseNamespacePreference(
  driver: DatabaseDriver | null | undefined,
  database: string | null | undefined,
) {
  const normalizedDriver =
    normalizeDatabaseDriverName(String(driver || "")) || driver;
  if (normalizedDriver === "sqlserver") return null;
  const trimmed = database?.trim();
  return trimmed || null;
}

export function selectPreferredNamespace(
  driver: DatabaseDriver | null | undefined,
  namespaces: string[],
  preferred: Array<string | null | undefined> = [],
) {
  if (namespaces.length === 0) return null;

  for (const candidate of preferred) {
    const trimmed = candidate?.trim();
    if (trimmed && namespaces.includes(trimmed)) return trimmed;
  }

  const normalizedDriver =
    normalizeDatabaseDriverName(String(driver || "")) || driver;
  if (normalizedDriver === "sqlserver") {
    const defaultSqlServerSchema = namespaces.find(
      (namespace) => namespace.toLowerCase() === "dbo",
    );
    if (defaultSqlServerSchema) return defaultSqlServerSchema;
  }

  const publicNamespace = namespaces.find(
    (namespace) => namespace.toLowerCase() === "public",
  );
  if (publicNamespace) return publicNamespace;

  return (
    namespaces.find((namespace) => !isSystemNamespace(driver, namespace)) ||
    namespaces[0] ||
    null
  );
}
