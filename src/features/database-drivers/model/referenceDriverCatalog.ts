import type {
  DatabaseDriverCatalogEntry,
  DatabaseDriverInstallation,
} from "@/services/tauri/types";

/**
 * Product-planning inventory, based on DBX's public DatabaseType catalogue.
 *
 * This is deliberately not a list of executable drivers. A row becomes
 * selectable only after the matching signed package has been installed,
 * verified, activated, and (for JDBC) has a verified managed runtime. Keeping
 * the planning catalogue separate prevents an attractive driver picker from
 * promising a connection that the local host cannot safely create.
 */
export type DriverCandidateDataModel =
  | "relational"
  | "document"
  | "keyValue"
  | "search"
  | "graph"
  | "wideColumn"
  | "timeSeries"
  | "coordination"
  | "queue";

export type DriverCandidateRuntime = "bundled" | "native" | "jdbc" | "http";

export type DatabaseDriverCandidate = {
  driver: string;
  displayName: string;
  dataModel: DriverCandidateDataModel;
  preferredRuntime: DriverCandidateRuntime;
  /** The only LSP route a future package may declare without a custom server. */
  genericLspLanguageId: "sql" | "mongodb" | "redis" | "elasticsearch-dsl" | null;
  source: "dbx-reference" | "compatibility";
};

const candidate = (
  driver: string,
  displayName: string,
  dataModel: DriverCandidateDataModel,
  preferredRuntime: DriverCandidateRuntime,
  genericLspLanguageId: DatabaseDriverCandidate["genericLspLanguageId"] =
    dataModel === "relational" ? "sql" : null,
  source: DatabaseDriverCandidate["source"] = "dbx-reference",
): DatabaseDriverCandidate => ({
  driver,
  displayName,
  dataModel,
  preferredRuntime,
  genericLspLanguageId,
  source,
});

// The 68 DBX reference types, plus five widely used compatible SQL products.
// The latter are intentionally labelled compatibility instead of pretending
// that DBX itself ships a profile for them.
export const REFERENCE_DATABASE_DRIVER_CANDIDATES = [
  candidate("mysql", "MySQL / MariaDB", "relational", "bundled"),
  candidate("postgres", "PostgreSQL", "relational", "bundled"),
  candidate("sqlite", "SQLite", "relational", "bundled"),
  candidate("rqlite", "rqlite", "relational", "http"),
  candidate("redis", "Redis", "keyValue", "bundled", "redis"),
  candidate("duckdb", "DuckDB", "relational", "native"),
  candidate("clickhouse", "ClickHouse", "relational", "native"),
  candidate("sqlserver", "Microsoft SQL Server", "relational", "jdbc"),
  candidate("mongodb", "MongoDB", "document", "bundled", "mongodb"),
  candidate("oracle", "Oracle Database", "relational", "jdbc"),
  candidate("elasticsearch", "Elasticsearch", "search", "bundled", "elasticsearch-dsl"),
  candidate("easysearch", "Easysearch", "search", "http", "elasticsearch-dsl"),
  candidate("hbase", "Apache HBase", "wideColumn", "jdbc"),
  candidate("qdrant", "Qdrant", "search", "http"),
  candidate("milvus", "Milvus", "search", "http"),
  candidate("weaviate", "Weaviate", "search", "http"),
  candidate("chromadb", "ChromaDB", "search", "http"),
  candidate("doris", "Apache Doris", "relational", "jdbc"),
  candidate("starrocks", "StarRocks", "relational", "jdbc"),
  // DBX publishes a SQL dialect for Manticore. Keep its search workspace and
  // capability boundary, but allow a future signed package to opt into the
  // generic SQL editor/catalog completion route.
  candidate("manticoresearch", "Manticore Search", "search", "http", "sql"),
  candidate("databend", "Databend", "relational", "http"),
  candidate("redshift", "Amazon Redshift", "relational", "jdbc"),
  candidate("dameng", "Dameng", "relational", "jdbc"),
  candidate("kingbase", "KingbaseES", "relational", "jdbc"),
  candidate("highgo", "HighGo", "relational", "jdbc"),
  candidate("uxdb", "UXDB", "relational", "jdbc"),
  candidate("vastbase", "Vastbase", "relational", "jdbc"),
  candidate("goldendb", "GoldenDB", "relational", "jdbc"),
  candidate("gaussdb", "GaussDB", "relational", "jdbc"),
  candidate("kwdb", "KWDB", "relational", "jdbc"),
  candidate("yashandb", "YashanDB", "relational", "jdbc"),
  candidate("databricks", "Databricks SQL", "relational", "jdbc"),
  candidate("saphana", "SAP HANA", "relational", "jdbc"),
  candidate("teradata", "Teradata", "relational", "jdbc"),
  candidate("vertica", "Vertica", "relational", "jdbc"),
  candidate("firebird", "Firebird", "relational", "jdbc"),
  candidate("exasol", "Exasol", "relational", "jdbc"),
  candidate("opengauss", "openGauss", "relational", "jdbc"),
  candidate("oceanbase-oracle", "OceanBase (Oracle mode)", "relational", "jdbc"),
  candidate("gbase", "GBase", "relational", "jdbc"),
  candidate("access", "Microsoft Access", "relational", "jdbc"),
  candidate("h2", "H2", "relational", "jdbc"),
  candidate("snowflake", "Snowflake", "relational", "jdbc"),
  candidate("trino", "Trino", "relational", "jdbc"),
  candidate("prestosql", "PrestoSQL", "relational", "jdbc"),
  candidate("hive", "Apache Hive", "relational", "jdbc"),
  candidate("spark", "Apache Spark SQL", "relational", "jdbc"),
  candidate("db2", "IBM Db2", "relational", "jdbc"),
  candidate("informix", "IBM Informix", "relational", "jdbc"),
  candidate("neo4j", "Neo4j", "graph", "jdbc"),
  candidate("cassandra", "Apache Cassandra", "wideColumn", "jdbc"),
  candidate("bigquery", "Google BigQuery", "relational", "jdbc"),
  candidate("kylin", "Apache Kylin", "relational", "jdbc"),
  candidate("sundb", "SunDB", "relational", "jdbc"),
  candidate("oscar", "OscarDB", "relational", "jdbc"),
  candidate("tdengine", "TDengine", "timeSeries", "jdbc"),
  candidate("xugu", "Xugu", "relational", "jdbc"),
  candidate("iotdb", "Apache IoTDB", "timeSeries", "jdbc"),
  candidate("etcd", "etcd", "coordination", "http"),
  candidate("zookeeper", "Apache ZooKeeper", "coordination", "jdbc"),
  candidate("nacos", "Nacos", "coordination", "http"),
  candidate("iris", "InterSystems IRIS", "relational", "jdbc"),
  candidate("turso", "Turso", "relational", "http"),
  candidate("cloudflare-d1", "Cloudflare D1", "relational", "http"),
  candidate("influxdb", "InfluxDB", "timeSeries", "http"),
  // QuestDB's DBX dialect is SQL-shaped. This is editor-only guidance: it
  // does not turn a time-series package into a relational grid driver.
  candidate("questdb", "QuestDB", "timeSeries", "http", "sql"),
  candidate("jdbc", "Generic JDBC", "relational", "jdbc"),
  candidate("mq", "Message Queue administration", "queue", "http"),
  candidate("cockroachdb", "CockroachDB", "relational", "jdbc", "sql", "compatibility"),
  candidate("yugabytedb", "YugabyteDB", "relational", "jdbc", "sql", "compatibility"),
  candidate("timescaledb", "TimescaleDB", "relational", "jdbc", "sql", "compatibility"),
  candidate("tidb", "TiDB", "relational", "jdbc", "sql", "compatibility"),
  candidate("greenplum", "Greenplum", "relational", "jdbc", "sql", "compatibility"),
] as const satisfies readonly DatabaseDriverCandidate[];

/**
 * Product ids mirrored from dbx `DatabaseType`. Keep this exported rather
 * than deriving coverage from UI text so release/conformance checks can prove
 * that a reference product was not silently dropped while the UI was edited.
 */
export const DBX_REFERENCE_DRIVER_IDS = REFERENCE_DATABASE_DRIVER_CANDIDATES
  .filter((candidate) => candidate.source === "dbx-reference")
  .map((candidate) => candidate.driver);

/**
 * DBX ships a smaller declarative dialect set in addition to its broader
 * DatabaseType menu. Keep those descriptor-backed products explicit so a
 * catalogue cleanup cannot silently drop a dialect that has SQL/type/metadata
 * reference material. `postgres` and `oceanbase-oracle` are the normalized
 * Oxide identifiers for DBX's `postgresql` and `oceanbase` descriptors.
 */
export const DBX_DIALECT_REFERENCE_DRIVER_IDS = [
  "access",
  "clickhouse",
  "dameng",
  "databend",
  "doris",
  "duckdb",
  "exasol",
  "firebird",
  "gaussdb",
  "gbase",
  "goldendb",
  "h2",
  "highgo",
  "informix",
  "iris",
  "kingbase",
  "kwdb",
  "manticoresearch",
  "mysql",
  "oceanbase-oracle",
  "opengauss",
  "oracle",
  "postgres",
  "questdb",
  "redshift",
  "rqlite",
  "sqlite",
  "sqlserver",
  "starrocks",
  "sundb",
  "turso",
  "vastbase",
  "vertica",
  "xugu",
  "yashandb",
] as const satisfies readonly DatabaseDriverCandidate["driver"][];

export type DriverCandidateAvailability =
  | "bundled"
  | "activePackage"
  | "requiresPackage";

/**
 * The package and editor route planned for a product in the DBX reference
 * catalogue. This is deliberately a planning contract, not an activation
 * result: a row remains unavailable until its exact signed package is ready.
 *
 * Keeping this alongside the product inventory makes two important details
 * explicit to package authors and users alike:
 *
 * - a SQL-shaped product can use a dedicated parser only where Oxide ships
 *   one; all other relational products use the bounded generic SQL route;
 * - document, graph and operational products need a native workspace/provider
 *   instead of being quietly coerced into the relational Grid.
 */
export type ReferenceDriverRuntimeRoute =
  | "bundled"
  | "signedSidecar"
  | "signedJdbc"
  | "dedicatedWorkspace";

export type ReferenceDriverLspRoute =
  | "dedicated"
  | "compatibleSql"
  | "genericSql"
  | "nativeProvider"
  | "notApplicable";

export type ReferenceDriverDeliveryPlan = {
  runtimeRoute: ReferenceDriverRuntimeRoute;
  lspRoute: ReferenceDriverLspRoute;
  /** Set only when the bundled language server has that concrete parser. */
  lspLanguageId: string | null;
  /**
   * Parser baseline a future signed capability contract may use. Generic SQL
   * stays generic in the UI; this value only makes the grammar family visible
   * to package authors and Driver Manager users.
   */
  lspServerDialect: string | null;
  /** Concrete parser used behind a vendor compatibility identity. */
  lspParserBaseline:
    | "postgres"
    | "mysql"
    | "sqlite"
    | "duckdb"
    | "hive"
    | "clickhouse"
    | null;
  /** Short UI text; it must never imply an uninstalled product is usable. */
  lspLabel: string;
};

const BUNDLED_DRIVER_IDS = new Set([
  "postgres",
  "mysql",
  "sqlite",
  "redis",
  "elasticsearch",
  "mongodb",
]);

const SIDECAR_SOURCE_DRIVER_IDS = new Set(["duckdb", "rqlite", "clickhouse"]);

// These identities are implemented by the bundled SQL language server. The
// table mirrors the DBX semantic dialect families, but does not promote a
// protocol-compatible database to a vendor-specific parser.
const DEDICATED_SQL_LSP_BY_DRIVER: Readonly<Record<string, string>> = {
  postgres: "postgres",
  mysql: "mysql",
  sqlite: "sqlite",
  rqlite: "sqlite",
  duckdb: "duckdb",
  clickhouse: "clickhouse",
  hive: "hive",
};

// DBX descriptor-backed and reviewed protocol-compatible products retain a
// vendor identity in the LSP session while delegating to a conservative parser
// baseline. This is intentionally separate from `DEDICATED_SQL_LSP_BY_DRIVER`:
// an alias is replaceable by a real parser later and must never be presented as
// vendor-native diagnostics in the meantime.
export const SQL_LSP_COMPATIBILITY_BASELINE_BY_DRIVER: Readonly<
  Record<string, "postgres" | "mysql" | "sqlite">
> = {
  access: "postgres",
  cockroachdb: "postgres",
  dameng: "postgres",
  db2: "postgres",
  databend: "mysql",
  doris: "mysql",
  exasol: "postgres",
  firebird: "postgres",
  gaussdb: "postgres",
  gbase: "mysql",
  goldendb: "mysql",
  greenplum: "postgres",
  h2: "postgres",
  highgo: "postgres",
  informix: "postgres",
  iris: "postgres",
  kingbase: "postgres",
  kwdb: "postgres",
  manticoresearch: "mysql",
  "oceanbase-oracle": "postgres",
  opengauss: "postgres",
  oracle: "postgres",
  questdb: "postgres",
  redshift: "postgres",
  sqlserver: "postgres",
  starrocks: "mysql",
  sundb: "mysql",
  tidb: "mysql",
  timescaledb: "postgres",
  turso: "sqlite",
  vastbase: "postgres",
  vertica: "postgres",
  "cloudflare-d1": "sqlite",
  xugu: "postgres",
  yashandb: "postgres",
  yugabytedb: "postgres",
};

/**
 * Resolve the safe delivery and completion route for every DBX reference
 * product. Callers must combine this with `driverCandidateAvailability` before
 * exposing a connection choice; this function intentionally never checks an
 * installation and therefore can never make a candidate executable.
 */
export function referenceDriverDeliveryPlan(
  candidate: DatabaseDriverCandidate,
): ReferenceDriverDeliveryPlan {
  const dedicatedLanguage = DEDICATED_SQL_LSP_BY_DRIVER[candidate.driver];
  const runtimeRoute: ReferenceDriverRuntimeRoute = BUNDLED_DRIVER_IDS.has(
    candidate.driver,
  )
    ? "bundled"
    : SIDECAR_SOURCE_DRIVER_IDS.has(candidate.driver) ||
        candidate.preferredRuntime === "http" ||
        candidate.preferredRuntime === "native"
      ? candidate.dataModel === "relational" || candidate.genericLspLanguageId
        ? "signedSidecar"
        : "dedicatedWorkspace"
      : candidate.preferredRuntime === "jdbc"
        ? candidate.dataModel === "relational"
          ? "signedJdbc"
          : "dedicatedWorkspace"
        : "dedicatedWorkspace";

  if (dedicatedLanguage) {
    return {
      runtimeRoute,
      lspRoute: "dedicated",
      lspLanguageId: dedicatedLanguage,
      lspServerDialect: dedicatedLanguage,
      lspParserBaseline: dedicatedLanguage as ReferenceDriverDeliveryPlan["lspParserBaseline"],
      lspLabel: `${dedicatedLanguage} intelligence`,
    };
  }

  if (
    candidate.dataModel === "relational" ||
    candidate.genericLspLanguageId === "sql"
  ) {
    const compatibilityBaseline =
      SQL_LSP_COMPATIBILITY_BASELINE_BY_DRIVER[candidate.driver];
    if (compatibilityBaseline) {
      return {
        runtimeRoute,
        lspRoute: "compatibleSql",
        lspLanguageId: "sql",
        lspServerDialect: candidate.driver,
        lspParserBaseline: compatibilityBaseline,
        lspLabel: `${candidate.displayName} compatibility intelligence · ${compatibilityBaseline} baseline`,
      };
    }

    return {
      runtimeRoute,
      lspRoute: "genericSql",
      lspLanguageId: "sql",
      lspServerDialect: "postgres",
      lspParserBaseline: "postgres",
      lspLabel: "SQL generic intelligence · postgres baseline",
    };
  }

  if (candidate.genericLspLanguageId) {
    return {
      runtimeRoute,
      lspRoute: "nativeProvider",
      lspLanguageId: candidate.genericLspLanguageId,
      lspServerDialect: null,
      lspParserBaseline: null,
      lspLabel: `${candidate.genericLspLanguageId} provider`,
    };
  }

  return {
    runtimeRoute,
    lspRoute: "notApplicable",
    lspLanguageId: null,
    lspServerDialect: null,
    lspParserBaseline: null,
    lspLabel: "Dedicated workspace required",
  };
}

/**
 * A package being active only proves that its signed archive was accepted. It
 * does not prove which server releases were exercised. Keep that release
 * evidence separate, and bind it to the exact active package version.
 */
export type DriverCandidateConformance = {
  state: "bundled" | "notInstalled" | "activeUnrecorded" | "activeRecorded";
  verifiedVersions: string[];
};

export function driverCandidateAvailability(
  candidate: DatabaseDriverCandidate,
  installations: readonly DatabaseDriverInstallation[],
): DriverCandidateAvailability {
  if (BUNDLED_DRIVER_IDS.has(candidate.driver)) return "bundled";

  const activePackage = installations.some(
    (installation) =>
      installation.driver === candidate.driver &&
      installation.distribution === "external" &&
      installation.status === "ready" &&
      installation.active === true &&
      installation.runtimeReady !== false,
  );
  return activePackage ? "activePackage" : "requiresPackage";
}

export function driverCandidateConformance(
  candidate: DatabaseDriverCandidate,
  installations: readonly DatabaseDriverInstallation[],
  catalogEntries: readonly DatabaseDriverCatalogEntry[],
): DriverCandidateConformance {
  if (BUNDLED_DRIVER_IDS.has(candidate.driver)) {
    return { state: "bundled", verifiedVersions: [] };
  }

  const activePackage = installations.find(
    (installation) =>
      installation.driver === candidate.driver &&
      installation.distribution === "external" &&
      installation.status === "ready" &&
      installation.active === true &&
      installation.runtimeReady !== false,
  );
  if (!activePackage) return { state: "notInstalled", verifiedVersions: [] };

  const release = catalogEntries.find(
    (entry) =>
      entry.driverId === candidate.driver &&
      entry.packageVersion === activePackage.packageVersion,
  );
  const conformance = release?.conformance;
  const evidenceCovers = (operation: string, version: string) =>
    conformance?.evidence?.some(
      (evidence) =>
        evidence.schemaVersion === 1 &&
        evidence.driverId === candidate.driver &&
        evidence.packageVersion === activePackage.packageVersion &&
        evidence.serverVersion.trim().toLowerCase() ===
          version.trim().toLowerCase() &&
        evidence.operations.includes(
          operation as (typeof evidence.operations)[number],
        ),
    ) ?? false;
  const verifiedVersions = Array.from(
    new Set(
      [
        ["connect", conformance?.connect || []] as const,
        ["metadata", conformance?.metadata || []] as const,
        ["query", conformance?.query || []] as const,
        ["cancellation", conformance?.cancellation || []] as const,
        ["mutations", conformance?.mutations || []] as const,
        ["migration", conformance?.migration || []] as const,
        ["dataTransfer", conformance?.dataTransfer || []] as const,
      ]
        .flatMap(([operation, versions]) =>
          versions.filter((version) => evidenceCovers(operation, version)),
        )
        .map((version) => version.trim())
        .filter(Boolean),
    ),
  );

  return {
    state: verifiedVersions.length ? "activeRecorded" : "activeUnrecorded",
    verifiedVersions,
  };
}

export function referenceDriverCandidate(driver: string) {
  const normalized = driver.trim().toLowerCase();
  return REFERENCE_DATABASE_DRIVER_CANDIDATES.find(
    (candidate) => candidate.driver === normalized,
  );
}
