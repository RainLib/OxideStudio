/**
 * Safe authoring defaults for relational JDBC driver packages.
 *
 * A profile is not an execution authorization and deliberately contains no
 * DDL, Grid mutation, or data-transfer claim. It only prevents every vendor
 * package from inventing connection/editor defaults independently.
 */
export const JDBC_DIALECT_PROFILES = Object.freeze({
  generic: {
    lspLanguageId: "sql",
    lspServerDialect: "postgres",
    namespaceLabel: "schema",
    identifierQuote: '"',
    defaultPort: 0,
  },
  postgres: {
    lspLanguageId: "postgres",
    lspServerDialect: "postgres",
    namespaceLabel: "schema",
    identifierQuote: '"',
    defaultPort: 5432,
  },
  // Protocol-compatible products can inherit PostgreSQL's connection naming
  // and quoting without falsely claiming PostgreSQL diagnostics. A release
  // author may opt into the exact `postgres` profile only after validating it.
  "postgres-compatible": {
    lspLanguageId: "sql",
    lspServerDialect: "postgres",
    namespaceLabel: "schema",
    identifierQuote: '"',
    defaultPort: 5432,
  },
  mysql: {
    lspLanguageId: "mysql",
    lspServerDialect: "mysql",
    namespaceLabel: "database",
    identifierQuote: "`",
    defaultPort: 3306,
  },
  // Same conservative distinction for MySQL-wire-compatible products. Their
  // SQL grammar and metadata can differ substantially from MySQL itself.
  "mysql-compatible": {
    lspLanguageId: "sql",
    lspServerDialect: "mysql",
    namespaceLabel: "database",
    identifierQuote: "`",
    defaultPort: 3306,
  },
  sqlserver: {
    // `sqlserver` is a reviewed compatibility identity backed by the generic
    // PostgreSQL parser today. Keeping the vendor id lets the server replace
    // that alias with a dedicated parser without changing package manifests.
    lspLanguageId: "sql",
    lspServerDialect: "sqlserver",
    namespaceLabel: "schema",
    identifierQuote: "[",
    defaultPort: 1433,
  },
  oracle: {
    lspLanguageId: "sql",
    lspServerDialect: "oracle",
    namespaceLabel: "schema",
    identifierQuote: '"',
    defaultPort: 1521,
  },
  h2: {
    lspLanguageId: "sql",
    lspServerDialect: "h2",
    namespaceLabel: "schema",
    identifierQuote: '"',
    defaultPort: 9092,
  },
  hive: {
    lspLanguageId: "hive",
    lspServerDialect: "hive",
    namespaceLabel: "database",
    identifierQuote: "`",
    defaultPort: 10000,
  },
  argo: {
    // Keep the Argo product identity visible to the LSP session while the
    // bundled registry delegates parsing to its reviewed Hive baseline.
    lspLanguageId: "sql",
    lspServerDialect: "argo",
    namespaceLabel: "database",
    identifierQuote: "`",
    defaultPort: 10000,
  },
});

/**
 * Conservative authoring defaults for the relational JDBC entries tracked in
 * the DBX reference catalogue. This table is deliberately not a support
 * matrix: it selects only connection/editor defaults for a package author and
 * never grants DDL, grid-mutation, migration, or vendor-diagnostic claims.
 */
export const JDBC_REFERENCE_DIALECT_PROFILE_NAMES = Object.freeze({
  access: "generic",
  argo: "argo",
  bigquery: "generic",
  cockroachdb: "postgres-compatible",
  dameng: "oracle",
  databend: "generic",
  databricks: "generic",
  db2: "generic",
  doris: "mysql-compatible",
  exasol: "generic",
  firebird: "generic",
  gaussdb: "postgres-compatible",
  gbase: "generic",
  // GoldenDB follows the MySQL-compatible product route. It remains a
  // generic SQL document until a vendor conformance fixture earns a dedicated
  // dialect, but keeps backtick and database-namespace semantics meanwhile.
  goldendb: "mysql-compatible",
  greenplum: "postgres-compatible",
  h2: "h2",
  highgo: "postgres-compatible",
  hive: "hive",
  informix: "generic",
  iris: "generic",
  jdbc: "generic",
  kingbase: "postgres-compatible",
  kwdb: "postgres-compatible",
  kylin: "generic",
  mysql: "mysql",
  "oceanbase-oracle": "oracle",
  opengauss: "postgres-compatible",
  oracle: "oracle",
  oscar: "generic",
  postgres: "postgres",
  prestosql: "generic",
  redshift: "postgres-compatible",
  saphana: "generic",
  snowflake: "generic",
  spark: "generic",
  sqlserver: "sqlserver",
  starrocks: "mysql-compatible",
  sundb: "generic",
  tdengine: "generic",
  teradata: "generic",
  tidb: "mysql-compatible",
  timescaledb: "postgres-compatible",
  trino: "generic",
  uxdb: "postgres-compatible",
  vastbase: "postgres-compatible",
  vertica: "generic",
  xugu: "generic",
  yashandb: "generic",
  yugabytedb: "postgres-compatible",
});

// Vendor identities that the bundled LSP registry resolves through a reviewed
// compatibility alias. Entries absent here intentionally retain their generic
// profile baseline until a dialect fixture is available.
export const JDBC_REFERENCE_LSP_SERVER_DIALECTS = Object.freeze({
  access: "access",
  argo: "argo",
  cockroachdb: "cockroachdb",
  dameng: "dameng",
  db2: "db2",
  databend: "databend",
  doris: "doris",
  exasol: "exasol",
  firebird: "firebird",
  gaussdb: "gaussdb",
  gbase: "gbase",
  goldendb: "goldendb",
  greenplum: "greenplum",
  h2: "h2",
  highgo: "highgo",
  informix: "informix",
  iris: "iris",
  kingbase: "kingbase",
  kwdb: "kwdb",
  "oceanbase-oracle": "oceanbase-oracle",
  opengauss: "opengauss",
  oracle: "oracle",
  redshift: "redshift",
  sqlserver: "sqlserver",
  starrocks: "starrocks",
  sundb: "sundb",
  tidb: "tidb",
  timescaledb: "timescaledb",
  vastbase: "vastbase",
  vertica: "vertica",
  xugu: "xugu",
  yashandb: "yashandb",
  yugabytedb: "yugabytedb",
});

export function jdbcDialectProfile(name) {
  const normalized = String(name || "generic").trim().toLowerCase();
  const profile = JDBC_DIALECT_PROFILES[normalized];
  if (!profile) {
    throw new Error(`--dialect-profile must be one of: ${Object.keys(JDBC_DIALECT_PROFILES).join(", ")}`);
  }
  return { name: normalized, ...profile };
}

export function jdbcReferenceDialectProfile(referenceDriver) {
  const normalized = String(referenceDriver || "").trim().toLowerCase();
  const profileName = JDBC_REFERENCE_DIALECT_PROFILE_NAMES[normalized];
  if (!profileName) {
    throw new Error(
      `--reference-driver must be a known relational JDBC candidate: ${Object.keys(JDBC_REFERENCE_DIALECT_PROFILE_NAMES).join(", ")}`,
    );
  }
  const profile = jdbcDialectProfile(profileName);
  return {
    ...profile,
    lspServerDialect:
      JDBC_REFERENCE_LSP_SERVER_DIALECTS[normalized] || profile.lspServerDialect,
  };
}
