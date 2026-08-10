import type {
  DatabaseCapabilities,
  DatabaseDriver,
  DatabaseDriverInstallation,
  KnownDatabaseDriver,
} from "@/services/tauri/types";

type DatabaseDriverCapabilities = Omit<DatabaseCapabilities, "driver">;

export type DatabaseDriverProfile = {
  driver: DatabaseDriver;
  menuLabel: string;
  defaultDatabase: string;
  urlScheme: string;
  /** Present only when an active signed package owns a non-generic URL grammar. */
  connectionUrlTemplate?: string | null;
  protocolAliases: string[];
  sslModeParamName: string;
  sslModeParamAliases: string[];
  defaultIcon: string;
  iconClassName: string;
  defaultAccentClassName: string;
  capabilities: DatabaseDriverCapabilities;
};

export const DEFAULT_DATABASE_DRIVER: DatabaseDriver = "postgres";
const DEFAULT_LSP_DIALECT = "postgres";
// Only bundled SQLite has a static transport declaration. Every external
// package, including DuckDB, must carry its own signed connection-mode
// capability rather than acquiring file access from its display/driver ID.
const NATIVE_FILE_BASED_DATABASE_DRIVERS = new Set(["sqlite"]);
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
  "cockroachdb",
  "dameng",
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

const DATABASE_DRIVER_PROFILES: Record<
  KnownDatabaseDriver,
  DatabaseDriverProfile
> = {
  postgres: {
    driver: "postgres",
    menuLabel: "PostgreSQL",
    defaultDatabase: "postgres",
    urlScheme: "postgres",
    protocolAliases: ["postgres", "postgresql", "pgsql"],
    sslModeParamName: "sslmode",
    sslModeParamAliases: ["sslmode", "ssl"],
    defaultIcon: "Database",
    iconClassName: "text-blue-400",
    defaultAccentClassName:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 group-hover:bg-blue-500/20",
    capabilities: {
      displayName: "PostgreSQL",
      dataModel: "relational",
      lspLanguageId: "postgres",
      namespaceLabel: "schema",
      identifierQuote: '"',
      defaultPort: 5432,
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      tableExportFormats: ["csv", "json", "jsonl", "sql", "tsv", "xlsx", "parquet", "arrow"],
      supportsTableRowMutation: true,
      supportsTableDataTransfer: true,
      supportsTableDdl: true,
      supportsColumnAlteration: true,
      supportsIndexRename: true,
      supportsConstraintAlteration: true,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsDatabaseCatalogs: true,
      supportsCreateDatabase: true,
      supportsCreateDatabaseOwner: true,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: true,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: true,
      supportsViews: true,
      supportsReplaceView: true,
      supportsMaterializedViews: true,
      supportsTableIndexes: true,
      supportsTableConstraints: true,
      supportsForeignKeys: true,
      supportsCheckConstraints: true,
      supportsFunctions: true,
      supportsTransactions: true,
      supportsQueryCancellation: true,
      supportsExplainPlan: true,
      autoIncrementKeyword: null,
      defaultPrimaryKeyType: "SERIAL",
      commonDataTypes: [
        "INTEGER",
        "BIGINT",
        "SERIAL",
        "BIGSERIAL",
        "VARCHAR",
        "TEXT",
        "BOOLEAN",
        "DATE",
        "TIMESTAMP",
        "DECIMAL",
        "REAL",
        "DOUBLE PRECISION",
        "BYTEA",
        "JSONB",
        "UUID",
      ],
    },
  },
  mysql: {
    driver: "mysql",
    menuLabel: "MySQL / MariaDB",
    defaultDatabase: "",
    urlScheme: "mysql",
    protocolAliases: ["mysql", "mariadb"],
    sslModeParamName: "ssl-mode",
    sslModeParamAliases: ["ssl-mode", "sslMode", "sslmode", "ssl"],
    defaultIcon: "Monitor",
    iconClassName: "text-orange-400",
    defaultAccentClassName:
      "bg-orange-500/10 text-orange-600 dark:text-orange-400 group-hover:bg-orange-500/20",
    capabilities: {
      displayName: "MySQL",
      dataModel: "relational",
      lspLanguageId: "mysql",
      namespaceLabel: "database",
      identifierQuote: "`",
      defaultPort: 3306,
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      tableExportFormats: ["csv", "json", "jsonl", "sql", "tsv", "xlsx", "parquet", "arrow"],
      supportsTableRowMutation: true,
      supportsTableDataTransfer: true,
      supportsTableDdl: true,
      supportsColumnAlteration: true,
      supportsIndexRename: true,
      supportsConstraintAlteration: true,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: true,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: true,
      supportsCreateDatabaseCollation: true,
      supportsColumnComments: true,
      supportsInlineColumnComments: true,
      supportsRenameDatabase: false,
      supportsViews: true,
      supportsReplaceView: true,
      supportsMaterializedViews: false,
      supportsTableIndexes: true,
      supportsTableConstraints: true,
      supportsForeignKeys: true,
      supportsCheckConstraints: true,
      supportsFunctions: true,
      supportsTransactions: true,
      supportsQueryCancellation: true,
      supportsExplainPlan: true,
      autoIncrementKeyword: "AUTO_INCREMENT",
      defaultPrimaryKeyType: "INT",
      commonDataTypes: [
        "INT",
        "BIGINT",
        "VARCHAR",
        "TEXT",
        "DATE",
        "DATETIME",
        "BOOLEAN",
        "DECIMAL",
        "FLOAT",
        "DOUBLE",
        "TINYINT",
        "SMALLINT",
        "BLOB",
        "JSON",
      ],
    },
  },
  sqlite: {
    driver: "sqlite",
    menuLabel: "SQLite",
    defaultDatabase: ":memory:",
    urlScheme: "sqlite",
    protocolAliases: ["sqlite", "sqlite3"],
    sslModeParamName: "sslmode",
    sslModeParamAliases: [],
    defaultIcon: "Database",
    iconClassName: "text-sky-400",
    defaultAccentClassName:
      "bg-sky-500/10 text-sky-600 dark:text-sky-400 group-hover:bg-sky-500/20",
    capabilities: {
      displayName: "SQLite",
      dataModel: "relational",
      connectionMode: "file",
      lspLanguageId: "sqlite",
      namespaceLabel: "schema",
      identifierQuote: '"',
      defaultPort: 0,
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      tableExportFormats: ["csv", "json", "jsonl", "sql", "tsv", "xlsx", "parquet", "arrow"],
      supportsTableRowMutation: true,
      supportsTableDataTransfer: true,
      supportsTableDdl: true,
      supportsColumnAlteration: false,
      supportsIndexRename: false,
      supportsConstraintAlteration: false,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: true,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: true,
      supportsTableConstraints: true,
      supportsForeignKeys: true,
      supportsCheckConstraints: true,
      supportsFunctions: false,
      supportsTransactions: true,
      supportsQueryCancellation: false,
      // The native driver can execute EXPLAIN, but the shared explain-plan
      // renderer has no SQLite plan adapter yet. Do not expose a broken action.
      supportsExplainPlan: false,
      autoIncrementKeyword: "AUTOINCREMENT",
      defaultPrimaryKeyType: "INTEGER",
      commonDataTypes: [
        "INTEGER",
        "REAL",
        "TEXT",
        "BLOB",
        "NUMERIC",
        "BOOLEAN",
        "DATE",
        "DATETIME",
        "JSON",
      ],
    },
  },
  redis: {
    driver: "redis",
    menuLabel: "Redis",
    defaultDatabase: "0",
    urlScheme: "redis",
    protocolAliases: ["redis"],
    sslModeParamName: "tls",
    sslModeParamAliases: ["tls", "ssl"],
    defaultIcon: "KeyRound",
    iconClassName: "text-red-400",
    defaultAccentClassName:
      "bg-red-500/10 text-red-600 dark:text-red-400 group-hover:bg-red-500/20",
    capabilities: {
      displayName: "Redis",
      dataModel: "keyValue",
      lspLanguageId: "redis",
      namespaceLabel: "database",
      identifierQuote: "",
      defaultPort: 6379,
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: true,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: false,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: false,
      supportsTableConstraints: false,
      supportsForeignKeys: false,
      supportsCheckConstraints: false,
      supportsFunctions: false,
      supportsTransactions: false,
      supportsQueryCancellation: false,
      supportsExplainPlan: false,
      autoIncrementKeyword: null,
      defaultPrimaryKeyType: "",
      commonDataTypes: ["string", "list", "set", "zset", "hash", "stream"],
    },
  },
  elasticsearch: {
    driver: "elasticsearch",
    menuLabel: "Elasticsearch",
    defaultDatabase: "",
    urlScheme: "http",
    protocolAliases: ["elasticsearch", "elastic"],
    sslModeParamName: "ssl",
    sslModeParamAliases: ["ssl", "tls"],
    defaultIcon: "Search",
    iconClassName: "text-amber-400",
    defaultAccentClassName:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 group-hover:bg-amber-500/20",
    capabilities: {
      displayName: "Elasticsearch",
      dataModel: "search",
      lspLanguageId: "elasticsearch-dsl",
      namespaceLabel: "index",
      identifierQuote: "",
      defaultPort: 9200,
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsCollectionBrowsing: true,
      supportsKeyValueBrowsing: false,
      supportsSchemas: false,
      supportsCreateDatabase: false,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: false,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: false,
      supportsTableConstraints: false,
      supportsForeignKeys: false,
      supportsCheckConstraints: false,
      supportsFunctions: false,
      supportsTransactions: false,
      supportsQueryCancellation: false,
      supportsExplainPlan: false,
      autoIncrementKeyword: null,
      defaultPrimaryKeyType: "",
      commonDataTypes: [
        "object",
        "keyword",
        "text",
        "long",
        "integer",
        "double",
        "boolean",
        "date",
        "nested",
        "geo_point",
      ],
    },
  },
  mongodb: {
    driver: "mongodb",
    menuLabel: "MongoDB",
    defaultDatabase: "admin",
    urlScheme: "mongodb",
    protocolAliases: ["mongodb", "mongo", "mongodb+srv"],
    sslModeParamName: "tls",
    sslModeParamAliases: ["tls", "ssl"],
    defaultIcon: "FileJson",
    iconClassName: "text-green-400",
    defaultAccentClassName:
      "bg-green-500/10 text-green-600 dark:text-green-400 group-hover:bg-green-500/20",
    capabilities: {
      displayName: "MongoDB",
      dataModel: "document",
      lspLanguageId: "mongodb",
      namespaceLabel: "database",
      identifierQuote: "",
      defaultPort: 27017,
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsCollectionBrowsing: true,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: false,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: true,
      supportsTableConstraints: false,
      supportsForeignKeys: false,
      supportsCheckConstraints: false,
      supportsFunctions: false,
      supportsTransactions: false,
      supportsQueryCancellation: false,
      supportsExplainPlan: false,
      autoIncrementKeyword: null,
      defaultPrimaryKeyType: "",
      commonDataTypes: [
        "objectId",
        "string",
        "int",
        "long",
        "double",
        "decimal",
        "bool",
        "date",
        "object",
        "array",
        "null",
      ],
    },
  },
};

const runtimeCapabilities = new Map<string, DatabaseCapabilities>();
const runtimeDriverProfiles = new Map<string, DatabaseDriverProfile>();
const externalRuntimeDriverKeys = new Set<string>();
let authoritativeDriverKeys: Set<string> | null = null;

function capabilitiesKey(driver: DatabaseDriver | string) {
  return String(driver).trim().toLowerCase();
}

function cloneCapabilities(
  capabilities: DatabaseCapabilities,
): DatabaseCapabilities {
  return {
    ...capabilities,
    dataModel: capabilities.dataModel || "relational",
    connectionMode:
      capabilities.connectionMode ??
      (NATIVE_FILE_BASED_DATABASE_DRIVERS.has(capabilitiesKey(capabilities.driver))
        ? "file"
        : "network"),
    supportsSqlQuery: capabilities.supportsSqlQuery ?? true,
    supportsTableBrowsing: capabilities.supportsTableBrowsing ?? true,
    tableExportFormats: [...(capabilities.tableExportFormats ?? [])],
    supportsTableRowMutation: capabilities.supportsTableRowMutation ?? false,
    supportsTableDataTransfer: capabilities.supportsTableDataTransfer ?? false,
    supportsTableDdl: capabilities.supportsTableDdl ?? false,
    supportsColumnAlteration: capabilities.supportsColumnAlteration ?? false,
    supportsIndexRename: capabilities.supportsIndexRename ?? false,
    supportsConstraintAlteration:
      capabilities.supportsConstraintAlteration ?? false,
    supportsCollectionBrowsing:
      capabilities.supportsCollectionBrowsing ?? false,
    supportsKeyValueBrowsing: capabilities.supportsKeyValueBrowsing ?? false,
    supportsDatabaseCatalogs: capabilities.supportsDatabaseCatalogs ?? false,
    supportsConnectionDatabase: capabilities.supportsConnectionDatabase ?? true,
    supportsExplainPlan: capabilities.supportsExplainPlan ?? false,
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

function cloneDriverProfile(
  profile: DatabaseDriverProfile,
): DatabaseDriverProfile {
  return {
    ...profile,
    protocolAliases: [...profile.protocolAliases],
    sslModeParamAliases: [...profile.sslModeParamAliases],
    capabilities: {
      ...profile.capabilities,
      dataModel: profile.capabilities.dataModel || "relational",
      connectionMode:
        profile.capabilities.connectionMode ??
        (NATIVE_FILE_BASED_DATABASE_DRIVERS.has(capabilitiesKey(profile.driver))
          ? "file"
          : "network"),
      supportsSqlQuery: profile.capabilities.supportsSqlQuery ?? true,
      supportsTableBrowsing: profile.capabilities.supportsTableBrowsing ?? true,
      tableExportFormats: [...(profile.capabilities.tableExportFormats ?? [])],
      supportsTableRowMutation:
        profile.capabilities.supportsTableRowMutation ?? false,
      supportsTableDataTransfer:
        profile.capabilities.supportsTableDataTransfer ?? false,
      supportsTableDdl: profile.capabilities.supportsTableDdl ?? false,
      supportsColumnAlteration:
        profile.capabilities.supportsColumnAlteration ?? false,
      supportsIndexRename: profile.capabilities.supportsIndexRename ?? false,
      supportsConstraintAlteration:
        profile.capabilities.supportsConstraintAlteration ?? false,
      supportsCollectionBrowsing:
        profile.capabilities.supportsCollectionBrowsing ?? false,
      supportsKeyValueBrowsing:
        profile.capabilities.supportsKeyValueBrowsing ?? false,
      supportsDatabaseCatalogs:
        profile.capabilities.supportsDatabaseCatalogs ?? false,
      supportsConnectionDatabase:
        profile.capabilities.supportsConnectionDatabase ?? true,
      supportsExplainPlan: profile.capabilities.supportsExplainPlan ?? false,
      commonDataTypes: [...profile.capabilities.commonDataTypes],
    },
  };
}

function profileCapabilitiesFromRuntime(
  capabilities: DatabaseCapabilities,
): DatabaseDriverCapabilities {
  const { driver: _driver, ...rest } = cloneCapabilities(capabilities);
  return rest;
}

function withRuntimeCapabilities(
  profile: DatabaseDriverProfile,
  capabilities?: DatabaseCapabilities,
): DatabaseDriverProfile {
  if (!capabilities) return profile;

  return {
    ...profile,
    driver: capabilities.driver,
    capabilities: profileCapabilitiesFromRuntime(capabilities),
  };
}

export function registerDatabaseCapabilities(
  capabilities: DatabaseCapabilities | DatabaseCapabilities[],
) {
  const values = Array.isArray(capabilities) ? capabilities : [capabilities];
  for (const value of values) {
    runtimeCapabilities.set(
      capabilitiesKey(value.driver),
      cloneCapabilities(value),
    );
  }
}

/**
 * Register the complete driver catalog advertised by the running backend.
 *
 * Individual capability lookups enrich one profile, but only the list command
 * is authoritative about which drivers can actually be created in this build.
 */
export function registerRuntimeDatabaseCatalog(
  capabilities: DatabaseCapabilities[],
) {
  registerDatabaseCapabilities(capabilities);
  authoritativeDriverKeys = new Set(
    capabilities.map((value) => capabilitiesKey(value.driver)),
  );
}

/**
 * Makes verified, active external packages selectable without pretending that
 * every possible package is a built-in driver. Package handshake capabilities
 * still gate operations at runtime; this profile only supplies the connection
 * form.
 */
export function syncExternalDatabaseDriverProfiles(
  installations: DatabaseDriverInstallation[],
) {
  for (const key of externalRuntimeDriverKeys) {
    runtimeDriverProfiles.delete(key);
  }
  externalRuntimeDriverKeys.clear();

  for (const installation of installations) {
    if (
      installation.distribution !== "external" ||
      installation.status !== "ready" ||
      !installation.active ||
      installation.runtimeReady === false ||
      !installation.driver.trim()
    ) {
      continue;
    }
    const profile = fallbackDatabaseDriverProfile(installation.driver);
    const declaredCapabilities = installation.capabilities
      ? cloneCapabilities(installation.capabilities)
      : profile.capabilities;
    const key = capabilitiesKey(installation.driver);
    runtimeDriverProfiles.set(key, {
      ...profile,
      menuLabel: installation.displayName || profile.menuLabel,
      connectionUrlTemplate: installation.connectionUrlTemplate,
      capabilities: {
        ...declaredCapabilities,
        displayName: installation.displayName || declaredCapabilities.displayName,
      },
    });
    externalRuntimeDriverKeys.add(key);
    authoritativeDriverKeys?.add(key);
  }
}

export function resetRuntimeDatabaseCatalogForTests() {
  authoritativeDriverKeys = null;
  runtimeCapabilities.clear();
  for (const key of externalRuntimeDriverKeys) {
    runtimeDriverProfiles.delete(key);
  }
  externalRuntimeDriverKeys.clear();
}

export function registerDatabaseDriverProfile(
  profile: DatabaseDriverProfile | DatabaseDriverProfile[],
) {
  const values = Array.isArray(profile) ? profile : [profile];
  for (const value of values) {
    const cloned = cloneDriverProfile(value);
    runtimeDriverProfiles.set(capabilitiesKey(cloned.driver), cloned);
  }
}

function formatDriverDisplayName(driver: DatabaseDriver) {
  return (
    String(driver)
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Database"
  );
}

function fallbackDatabaseDriverProfile(
  driver: DatabaseDriver,
): DatabaseDriverProfile {
  const displayName = formatDriverDisplayName(driver);
  return {
    driver,
    menuLabel: displayName,
    defaultDatabase: "",
    urlScheme: String(driver),
    protocolAliases: [String(driver)],
    sslModeParamName: "sslmode",
    sslModeParamAliases: ["sslmode", "ssl"],
    defaultIcon: "Database",
    iconClassName: "text-muted-foreground",
    defaultAccentClassName:
      "bg-muted text-muted-foreground group-hover:bg-muted/80",
    capabilities: {
      displayName,
      dataModel: "relational",
      connectionMode: NATIVE_FILE_BASED_DATABASE_DRIVERS.has(capabilitiesKey(driver))
        ? "file"
        : "network",
      lspLanguageId: "sql",
      namespaceLabel: "schema",
      identifierQuote: '"',
      defaultPort: 0,
      // Unknown ids are not a usable driver contract. An active signed
      // package replaces this profile with its declared capabilities.
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsTableRowMutation: false,
      supportsTableDdl: false,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsDatabaseCatalogs: false,
      supportsConnectionDatabase: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseOwner: false,
      supportsCreateDatabaseCharset: false,
      supportsCreateDatabaseCollation: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: false,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: false,
      supportsTableConstraints: false,
      supportsForeignKeys: false,
      supportsCheckConstraints: false,
      supportsFunctions: false,
      supportsTransactions: false,
      supportsQueryCancellation: false,
      supportsExplainPlan: false,
      autoIncrementKeyword: null,
      defaultPrimaryKeyType: "INTEGER",
      commonDataTypes: [
        "INTEGER",
        "BIGINT",
        "VARCHAR",
        "TEXT",
        "BOOLEAN",
        "DATE",
        "TIMESTAMP",
        "DECIMAL",
      ],
    },
  };
}

export function databaseDriverProfile(driver: DatabaseDriver) {
  const key = capabilitiesKey(driver);
  const profile =
    runtimeDriverProfiles.get(key) ??
    DATABASE_DRIVER_PROFILES[key as KnownDatabaseDriver] ??
    fallbackDatabaseDriverProfile(driver);
  return withRuntimeCapabilities(profile, runtimeCapabilities.get(key));
}

export function supportedDatabaseDriverProfiles() {
  const profiles = new Map<string, DatabaseDriverProfile>();
  for (const profile of Object.values(DATABASE_DRIVER_PROFILES)) {
    profiles.set(capabilitiesKey(profile.driver), profile);
  }
  for (const [key, profile] of runtimeDriverProfiles) {
    profiles.set(key, profile);
  }
  for (const [key, capabilities] of runtimeCapabilities) {
    if (!profiles.has(key)) {
      profiles.set(key, fallbackDatabaseDriverProfile(capabilities.driver));
    }
  }

  return Array.from(profiles.entries())
    .filter(
      ([key]) => !authoritativeDriverKeys || authoritativeDriverKeys.has(key),
    )
    .map(([, profile]) => databaseDriverProfile(profile.driver));
}

export function supportedDatabaseDrivers() {
  return supportedDatabaseDriverProfiles().map((profile) => profile.driver);
}

export function normalizeDatabaseDriverName(
  value: string,
): DatabaseDriver | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  for (const profile of supportedDatabaseDriverProfiles()) {
    if (
      profile.driver === normalized ||
      profile.protocolAliases.some(
        (alias) => alias.toLowerCase() === normalized,
      )
    ) {
      return profile.driver;
    }
  }
  return normalized as DatabaseDriver;
}

export function defaultDatabasePort(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).capabilities.defaultPort;
}

/**
 * File-backed engines do not use host/port, SSH or TLS form controls. Keep
 * this explicit instead of inferring it from port 0: external packages may
 * legitimately use a dynamic or non-network transport without being files.
 */
export function isFileBasedDatabaseDriver(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).capabilities.connectionMode === "file";
}

export function defaultDatabaseName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultDatabase;
}

export function connectionUrlScheme(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).urlScheme;
}

export function connectionUrlTemplateForDriver(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).connectionUrlTemplate?.trim() || null;
}

export function sslModeParamName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).sslModeParamName;
}

export function sslModeParamAliases(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).sslModeParamAliases;
}

export function defaultConnectionIcon(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultIcon;
}

export function defaultConnectionAccentClassName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultAccentClassName;
}

export function defaultDatabaseCapabilities(
  driver: DatabaseDriver,
): DatabaseCapabilities {
  const capabilities = databaseDriverProfile(driver).capabilities;
  return {
    driver,
    ...capabilities,
    supportsDatabaseCatalogs: capabilities.supportsDatabaseCatalogs ?? false,
    supportsConnectionDatabase:
      capabilities.supportsConnectionDatabase ?? true,
    tableExportFormats: [...(capabilities.tableExportFormats ?? [])],
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

export function isRelationalDataModel(
  capabilities: Pick<DatabaseCapabilities, "dataModel">,
) {
  return capabilities.dataModel === "relational";
}

export function supportsSqlWorkspace(
  capabilities: Pick<DatabaseCapabilities, "supportsSqlQuery">,
) {
  return capabilities.supportsSqlQuery;
}

export function supportsTableWorkspace(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "supportsTableBrowsing"
  >,
) {
  return (
    isRelationalDataModel(capabilities) && capabilities.supportsTableBrowsing
  );
}

/**
 * Metadata made available to SQL completion is deliberately broader than the
 * editable Data Grid. A signed SQL-shaped time-series package may expose
 * relation-like measurements and columns for completion without being a
 * relational table editor. The package must opt into both table browsing and
 * a supported SQL LSP route; a generic non-relational package cannot acquire
 * catalog metadata merely by returning table-shaped data.
 */
export function supportsSqlRelationMetadataLsp(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "lspLanguageId" | "supportsSqlQuery" | "supportsTableBrowsing"
  >,
) {
  return (
    capabilities.supportsTableBrowsing &&
    supportsLspCapabilities(capabilities)
  );
}

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

export function defaultStringDataType(
  capabilities: Pick<
    DatabaseCapabilities,
    "commonDataTypes" | "defaultPrimaryKeyType"
  >,
) {
  const preferred = ["VARCHAR", "TEXT", "STRING"];
  const type =
    preferred
      .map((candidate) =>
        capabilities.commonDataTypes.find(
          (value) => value.toUpperCase() === candidate,
        ),
      )
      .find(Boolean) ||
    capabilities.commonDataTypes[0] ||
    capabilities.defaultPrimaryKeyType ||
    "TEXT";
  return type;
}

export function defaultLengthForDataType(dataType: string) {
  const normalized = dataType.trim().toUpperCase();
  if (normalized === "VARCHAR" || normalized === "CHAR") return "255";
  if (normalized === "DECIMAL" || normalized === "NUMERIC") return "10,2";
  return "";
}

function normalizedDataTypeBase(dataType: string) {
  return dataType
    .trim()
    .toUpperCase()
    .split("(")[0]!
    .trim()
    .split(/\s+/)[0]!
    .trim();
}

export function supportsAutoIncrementForDataType(
  capabilities: Pick<
    DatabaseCapabilities,
    "autoIncrementKeyword" | "commonDataTypes" | "lspLanguageId"
  >,
  dataType: string,
) {
  const baseType = normalizedDataTypeBase(dataType);
  if (!baseType) return false;

  const integerTypes = new Set([
    "TINYINT",
    "SMALLINT",
    "MEDIUMINT",
    "INT",
    "INTEGER",
    "BIGINT",
  ]);

  if (capabilities.autoIncrementKeyword) {
    return integerTypes.has(baseType);
  }

  if (["SMALLSERIAL", "SERIAL", "BIGSERIAL"].includes(baseType)) {
    return true;
  }

  if ((capabilities.lspLanguageId || "").toLowerCase() === "postgres") {
    return (
      integerTypes.has(baseType) || ["INT2", "INT4", "INT8"].includes(baseType)
    );
  }

  return false;
}

function quoteIdentifierWithDelimiter(quote: string, identifier: string) {
  // The runtime driver contract intentionally stores one identifier quote value.
  // Square brackets are the only asymmetric dialect delimiter we accept, so keep
  // its closing delimiter and escaping rules here instead of generating `[name[`.
  if (quote === "[") {
    return "[" + identifier.split("]").join("]]") + "]";
  }

  return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`;
}

export function quoteIdentifier(driver: DatabaseDriver, identifier: string) {
  const quote = databaseDriverProfile(driver).capabilities.identifierQuote;
  return quoteIdentifierWithDelimiter(quote, identifier);
}

export function quoteIdentifierWithCapabilities(
  capabilities: Pick<DatabaseCapabilities, "identifierQuote">,
  identifier: string,
) {
  const quote = capabilities.identifierQuote || '"';
  return quoteIdentifierWithDelimiter(quote, identifier);
}

export function qualifiedTableName(
  driver: DatabaseDriver,
  schema: string | null | undefined,
  table: string,
) {
  if (!schema) return quoteIdentifier(driver, table);
  return `${quoteIdentifier(driver, schema)}.${quoteIdentifier(driver, table)}`;
}

export function previewTableQuery(
  driver: DatabaseDriver,
  schema: string | null | undefined,
  table: string,
  limit = 500,
) {
  return `SELECT * FROM ${qualifiedTableName(driver, schema, table)} LIMIT ${limit};`;
}

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
  return queryEditorLanguageIdForCapabilities(defaultDatabaseCapabilities(driver));
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

export function normalizeRelationObjectType(objectType?: string | null) {
  return (objectType || "").trim().toUpperCase();
}

export function isViewObject(objectType?: string | null) {
  return normalizeRelationObjectType(objectType).includes("VIEW");
}

export function isMaterializedViewObject(objectType?: string | null) {
  const normalized = normalizeRelationObjectType(objectType);
  return normalized.includes("MATERIALIZED") && normalized.includes("VIEW");
}

export function isForeignTableObject(objectType?: string | null) {
  return normalizeRelationObjectType(objectType).includes("FOREIGN TABLE");
}

export function isReadOnlyRelationObject(objectType?: string | null) {
  return isViewObject(objectType) || isForeignTableObject(objectType);
}

export function canManageRelationIndexes(objectType?: string | null) {
  return (
    !isForeignTableObject(objectType) &&
    (!isViewObject(objectType) || isMaterializedViewObject(objectType))
  );
}

export function canAlterRelationStructure(objectType?: string | null) {
  return !isReadOnlyRelationObject(objectType);
}

export function relationObjectLabel(objectType?: string | null) {
  if (isMaterializedViewObject(objectType)) return "Materialized View";
  if (isViewObject(objectType)) return "View";
  if (isForeignTableObject(objectType)) return "Foreign Table";
  return "Table";
}

export function formatSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}
