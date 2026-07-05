import type {
  DatabaseCapabilities,
  DatabaseDriver,
  KnownDatabaseDriver,
} from "@/services/tauri/types";

type DatabaseDriverCapabilities = Omit<DatabaseCapabilities, "driver">;

export type DatabaseDriverProfile = {
  driver: DatabaseDriver;
  menuLabel: string;
  defaultDatabase: string;
  urlScheme: string;
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
const SUPPORTED_LSP_DIALECTS = new Set([
  "mysql",
  "postgres",
  "hive",
  "elasticsearch-eql",
  "elasticsearch-dsl",
  "clickhouse",
  "redis",
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
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: true,
      supportsCreateDatabaseCharset: false,
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
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: true,
      supportsCreateDatabaseCharset: true,
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
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: true,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseCharset: false,
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
      supportsCollectionBrowsing: true,
      supportsKeyValueBrowsing: false,
      supportsSchemas: false,
      supportsCreateDatabase: false,
      supportsCreateDatabaseCharset: false,
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
      lspLanguageId: "json",
      namespaceLabel: "database",
      identifierQuote: "",
      defaultPort: 27017,
      supportsSqlQuery: false,
      supportsTableBrowsing: false,
      supportsCollectionBrowsing: true,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseCharset: false,
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

function capabilitiesKey(driver: DatabaseDriver | string) {
  return String(driver).trim().toLowerCase();
}

function cloneCapabilities(
  capabilities: DatabaseCapabilities
): DatabaseCapabilities {
  return {
    ...capabilities,
    dataModel: capabilities.dataModel || "relational",
    supportsSqlQuery: capabilities.supportsSqlQuery ?? true,
    supportsTableBrowsing: capabilities.supportsTableBrowsing ?? true,
    supportsCollectionBrowsing: capabilities.supportsCollectionBrowsing ?? false,
    supportsKeyValueBrowsing: capabilities.supportsKeyValueBrowsing ?? false,
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

function cloneDriverProfile(profile: DatabaseDriverProfile): DatabaseDriverProfile {
  return {
    ...profile,
    protocolAliases: [...profile.protocolAliases],
    sslModeParamAliases: [...profile.sslModeParamAliases],
    capabilities: {
      ...profile.capabilities,
      dataModel: profile.capabilities.dataModel || "relational",
      supportsSqlQuery: profile.capabilities.supportsSqlQuery ?? true,
      supportsTableBrowsing: profile.capabilities.supportsTableBrowsing ?? true,
      supportsCollectionBrowsing:
        profile.capabilities.supportsCollectionBrowsing ?? false,
      supportsKeyValueBrowsing:
        profile.capabilities.supportsKeyValueBrowsing ?? false,
      commonDataTypes: [...profile.capabilities.commonDataTypes],
    },
  };
}

function profileCapabilitiesFromRuntime(
  capabilities: DatabaseCapabilities
): DatabaseDriverCapabilities {
  const { driver: _driver, ...rest } = cloneCapabilities(capabilities);
  return rest;
}

function withRuntimeCapabilities(
  profile: DatabaseDriverProfile,
  capabilities?: DatabaseCapabilities
): DatabaseDriverProfile {
  if (!capabilities) return profile;

  return {
    ...profile,
    driver: capabilities.driver,
    capabilities: profileCapabilitiesFromRuntime(capabilities),
  };
}

export function registerDatabaseCapabilities(
  capabilities: DatabaseCapabilities | DatabaseCapabilities[]
) {
  const values = Array.isArray(capabilities) ? capabilities : [capabilities];
  for (const value of values) {
    runtimeCapabilities.set(capabilitiesKey(value.driver), cloneCapabilities(value));
  }
}

export function registerDatabaseDriverProfile(
  profile: DatabaseDriverProfile | DatabaseDriverProfile[]
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
  driver: DatabaseDriver
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
      lspLanguageId: "sql",
      namespaceLabel: "schema",
      identifierQuote: '"',
      defaultPort: 0,
      supportsSqlQuery: true,
      supportsTableBrowsing: true,
      supportsCollectionBrowsing: false,
      supportsKeyValueBrowsing: false,
      supportsSchemas: true,
      supportsCreateDatabase: false,
      supportsCreateDatabaseCharset: false,
      supportsColumnComments: false,
      supportsInlineColumnComments: false,
      supportsRenameDatabase: false,
      supportsViews: true,
      supportsReplaceView: false,
      supportsMaterializedViews: false,
      supportsTableIndexes: true,
      supportsTableConstraints: true,
      supportsForeignKeys: true,
      supportsCheckConstraints: false,
      supportsFunctions: false,
      supportsTransactions: true,
      supportsQueryCancellation: false,
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

  return Array.from(profiles.values()).map((profile) =>
    databaseDriverProfile(profile.driver)
  );
}

export function supportedDatabaseDrivers() {
  return supportedDatabaseDriverProfiles().map((profile) => profile.driver);
}

export function normalizeDatabaseDriverName(value: string): DatabaseDriver | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  for (const profile of supportedDatabaseDriverProfiles()) {
    if (
      profile.driver === normalized ||
      profile.protocolAliases.some((alias) => alias.toLowerCase() === normalized)
    ) {
      return profile.driver;
    }
  }
  return normalized as DatabaseDriver;
}

export function defaultDatabasePort(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).capabilities.defaultPort;
}

export function defaultDatabaseName(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).defaultDatabase;
}

export function connectionUrlScheme(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).urlScheme;
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
  driver: DatabaseDriver
): DatabaseCapabilities {
  const capabilities = databaseDriverProfile(driver).capabilities;
  return {
    driver,
    ...capabilities,
    commonDataTypes: [...capabilities.commonDataTypes],
  };
}

export function isRelationalDataModel(
  capabilities: Pick<DatabaseCapabilities, "dataModel">
) {
  return capabilities.dataModel === "relational";
}

export function supportsSqlWorkspace(
  capabilities: Pick<DatabaseCapabilities, "supportsSqlQuery">
) {
  return capabilities.supportsSqlQuery;
}

export function supportsTableWorkspace(
  capabilities: Pick<
    DatabaseCapabilities,
    "dataModel" | "supportsTableBrowsing"
  >
) {
  return isRelationalDataModel(capabilities) && capabilities.supportsTableBrowsing;
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
  namespace: string | null | undefined
) {
  const normalizedDriver = normalizeDatabaseDriverName(String(driver || "")) || driver;
  const normalized = (namespace || "").trim().toLowerCase();
  if (!normalized) return false;

  if (normalizedDriver === "mysql") {
    return ["information_schema", "mysql", "performance_schema", "sys"].includes(
      normalized
    );
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

  return false;
}

export function selectPreferredNamespace(
  driver: DatabaseDriver | null | undefined,
  namespaces: string[],
  preferred: Array<string | null | undefined> = []
) {
  if (namespaces.length === 0) return null;

  for (const candidate of preferred) {
    const trimmed = candidate?.trim();
    if (trimmed && namespaces.includes(trimmed)) return trimmed;
  }

  const publicNamespace = namespaces.find(
    (namespace) => namespace.toLowerCase() === "public"
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
  >
) {
  const preferred = ["VARCHAR", "TEXT", "STRING"];
  const type =
    preferred
      .map((candidate) =>
        capabilities.commonDataTypes.find(
          (value) => value.toUpperCase() === candidate
        )
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
  dataType: string
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
    return integerTypes.has(baseType) || ["INT2", "INT4", "INT8"].includes(baseType);
  }

  return false;
}

export function quoteIdentifier(driver: DatabaseDriver, identifier: string) {
  const quote = databaseDriverProfile(driver).capabilities.identifierQuote;
  return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`;
}

export function quoteIdentifierWithCapabilities(
  capabilities: Pick<DatabaseCapabilities, "identifierQuote">,
  identifier: string
) {
  const quote = capabilities.identifierQuote || '"';
  return `${quote}${identifier.split(quote).join(quote + quote)}${quote}`;
}

export function qualifiedTableName(
  driver: DatabaseDriver,
  schema: string | null | undefined,
  table: string
) {
  if (!schema) return quoteIdentifier(driver, table);
  return `${quoteIdentifier(driver, schema)}.${quoteIdentifier(driver, table)}`;
}

export function previewTableQuery(
  driver: DatabaseDriver,
  schema: string | null | undefined,
  table: string,
  limit = 500
) {
  return `SELECT * FROM ${qualifiedTableName(driver, schema, table)} LIMIT ${limit};`;
}

export function lspLanguageId(driver: DatabaseDriver) {
  return normalizeLspDialect(configuredLspLanguageId(driver));
}

export function configuredLspLanguageId(driver: DatabaseDriver) {
  return databaseDriverProfile(driver).capabilities.lspLanguageId.trim().toLowerCase();
}

export function supportsLspLanguageId(driver: DatabaseDriver) {
  return SUPPORTED_LSP_DIALECTS.has(configuredLspLanguageId(driver));
}

export function queryEditorLanguageId(driver: DatabaseDriver) {
  const capabilities = databaseDriverProfile(driver).capabilities;
  if (capabilities.dataModel === "document" || capabilities.dataModel === "search") {
    return "json";
  }
  if (capabilities.dataModel === "keyValue") {
    return "plaintext";
  }
  return "sql";
}

export function normalizeLspDialect(
  dialect: string | null | undefined,
  fallback = DEFAULT_LSP_DIALECT
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
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replace(/'/g, "''")}'`;
}
