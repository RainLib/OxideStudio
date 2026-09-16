import { defaultDatabaseCapabilities } from "@/features/database-drivers/model/connectionDefaults";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types";

const DEFAULT_LSP_DIALECT = "postgres";

const SUPPORTED_LSP_DIALECTS = new Set([
  "mysql",
  "postgres",
  "hive",
  "elasticsearch-eql",
  "elasticsearch-dsl",
  "clickhouse",
  "sqlite",
  "duckdb",
  "redis",
  "mongodb",
  "json",
]);

// Only dialects implemented by the bundled SQL language server are valid as
// an explicit server baseline. Provider languages (Mongo, Redis, JSON, ES)
// keep their own completion route and must not be supplied as a SQL parser.
const SUPPORTED_SQL_LSP_SERVER_DIALECTS = new Set([
  "postgres",
  "mysql",
  "sqlite",
  "duckdb",
  "hive",
  "clickhouse",
  // Reviewed compatibility identities. The bundled server resolves each one
  // to an explicit parser baseline; retaining the vendor id keeps sessions,
  // status, and future dedicated parser upgrades product-specific.
  "access",
  "argo",
  "cockroachdb",
  "dameng",
  "db2",
  "databend",
  "doris",
  "exasol",
  "firebird",
  "gaussdb",
  "gbase",
  "goldendb",
  "greenplum",
  "h2",
  "highgo",
  "informix",
  "iris",
  "kingbase",
  "kwdb",
  "manticoresearch",
  "oceanbase-oracle",
  "opengauss",
  "oracle",
  "questdb",
  "redshift",
  "sqlserver",
  "starrocks",
  "sundb",
  "tidb",
  "timescaledb",
  "turso",
  "vastbase",
  "vertica",
  "cloudflare-d1",
  "xugu",
  "yashandb",
  "yugabytedb",
]);

export function lspLanguageId(driver: DatabaseDriver) {
  return lspLanguageIdForCapabilities(defaultDatabaseCapabilities(driver));
}

export function lspLanguageIdForCapabilities(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "lspLanguageId" | "supportsSqlQuery"
  >,
) {
  const dialect = configuredLspLanguageIdForCapabilities(capabilities);
  if (!dialect) return DEFAULT_LSP_DIALECT;
  return SUPPORTED_LSP_DIALECTS.has(dialect)
    ? normalizeLspDialect(dialect)
    : supportsGenericSqlLspCapabilities(capabilities)
      ? "sql"
      : dialect;
}

/**
 * The bundled server accepts concrete dialect names, not a generic `sql`
 * dialect. Keep `sql` as the document/editor language, but configure the
 * server with its stable PostgreSQL-compatible baseline so file schema
 * mappings and completion resolve against the same live document URI.
 */
export function lspServerDialectForCapabilities(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "lspLanguageId" | "lspServerDialect" | "supportsSqlQuery"
  >,
) {
  const languageId = lspLanguageIdForCapabilities(capabilities);
  const declaredServerDialect = (capabilities.lspServerDialect || "")
    .trim()
    .toLowerCase();
  // Signed packages may choose a reviewed server parser for a generic SQL
  // document. This lets MySQL-compatible engines preserve their grammar while
  // status/UI still state “SQL generic”, rather than claiming full native
  // diagnostics for the upstream product.
  if (
    languageId === "sql" &&
    SUPPORTED_SQL_LSP_SERVER_DIALECTS.has(declaredServerDialect)
  ) {
    return declaredServerDialect;
  }
  return languageId === "sql" ? DEFAULT_LSP_DIALECT : languageId;
}

export function configuredLspLanguageId(driver: DatabaseDriver) {
  return configuredLspLanguageIdForCapabilities(
    defaultDatabaseCapabilities(driver),
  );
}

export function configuredLspLanguageIdForCapabilities(
  capabilities: Pick<DatabaseCapabilities, "lspLanguageId">,
) {
  return capabilities.lspLanguageId.trim().toLowerCase();
}

export function supportsLspLanguageId(driver: DatabaseDriver) {
  return supportsLspCapabilities(defaultDatabaseCapabilities(driver));
}

export function supportsLspCapabilities(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "lspLanguageId" | "supportsSqlQuery"
  >,
) {
  const dialect = configuredLspLanguageIdForCapabilities(capabilities);
  return (
    SUPPORTED_LSP_DIALECTS.has(dialect) ||
    supportsGenericSqlLspCapabilities(capabilities)
  );
}

/**
 * dbx has many declarative dialect descriptors, while a downloaded Oxide
 * driver package can only claim a parser we ship. A relation-oriented package
 * with SQL query capability therefore falls back to the bundled generic SQL
 * completion path until a dedicated dialect is introduced. A non-relational
 * package can opt into that same path only with an explicit signed `sql`
 * language identity (for SQL-shaped time-series engines); its data model still
 * keeps it out of the relational grid and DDL UI.
 */
function supportsGenericSqlLspCapabilities(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "lspLanguageId" | "supportsSqlQuery"
  >,
) {
  const dialect = configuredLspLanguageIdForCapabilities(capabilities);
  return (
    capabilities.supportsSqlQuery &&
    (capabilities.dataModel === "relational" || dialect === "sql")
  );
}

export function queryEditorLanguageId(driver: DatabaseDriver) {
  return queryEditorLanguageIdForCapabilities(
    defaultDatabaseCapabilities(driver),
  );
}

export function queryEditorLanguageIdForCapabilities(
  capabilities: Pick<DatabaseCapabilities, "dataModel" | "lspLanguageId">,
) {
  // A non-relational package can explicitly opt into a SQL console (for
  // example QuestDB or Manticore Search). Keep this check before the generic
  // search/document route so the signed package contract, not the broad data
  // model label, decides the editor syntax.
  if (configuredLspLanguageIdForCapabilities(capabilities) === "sql") {
    return "sql";
  }
  if (
    capabilities.dataModel === "document" ||
    capabilities.dataModel === "search"
  ) {
    return "json";
  }
  if (capabilities.dataModel === "keyValue") {
    return "plaintext";
  }
  // A non-relational package may still be SQL-shaped (for example QuestDB).
  // It needs an explicit signed `sql` LSP identity to opt in; no product gets
  // SQL syntax merely from being a new/unknown data model.
  return capabilities.dataModel === "relational" ? "sql" : "plaintext";
}

export function normalizeLspDialect(
  dialect: string | null | undefined,
  fallback = DEFAULT_LSP_DIALECT,
) {
  const normalized = (dialect || "").trim().toLowerCase();
  if (SUPPORTED_LSP_DIALECTS.has(normalized)) return normalized;
  return SUPPORTED_LSP_DIALECTS.has(fallback) ? fallback : DEFAULT_LSP_DIALECT;
}
