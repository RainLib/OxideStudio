import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  JDBC_REFERENCE_DIALECT_PROFILE_NAMES,
  JDBC_REFERENCE_LSP_SERVER_DIALECTS,
  jdbcDialectProfile,
  jdbcReferenceDialectProfile,
} from "./driver-dialect-profiles.mjs";

test("maps each JDBC reference family to a conservative, known editor profile", () => {
  const expectedProfileNames = {
    cockroachdb: "postgres-compatible",
    argo: "argo",
    dameng: "oracle",
    databend: "generic",
    doris: "mysql-compatible",
    gaussdb: "postgres-compatible",
    goldendb: "mysql-compatible",
    greenplum: "postgres-compatible",
    h2: "h2",
    highgo: "postgres-compatible",
    hive: "hive",
    kingbase: "postgres-compatible",
    kwdb: "postgres-compatible",
    mysql: "mysql",
    "oceanbase-oracle": "oracle",
    opengauss: "postgres-compatible",
    oracle: "oracle",
    postgres: "postgres",
    redshift: "postgres-compatible",
    sqlserver: "sqlserver",
    starrocks: "mysql-compatible",
    tidb: "mysql-compatible",
    timescaledb: "postgres-compatible",
    uxdb: "postgres-compatible",
    vastbase: "postgres-compatible",
    yugabytedb: "postgres-compatible",
  };

  for (const [driver, profileName] of Object.entries(JDBC_REFERENCE_DIALECT_PROFILE_NAMES)) {
    const profile = jdbcReferenceDialectProfile(driver);
    assert.equal(profile.name, expectedProfileNames[driver] ?? "generic");
    assert.equal(profile.lspLanguageId === "postgres" || profile.lspLanguageId === "mysql", driver === "postgres" || driver === "mysql");
    assert.deepEqual(profile, {
      ...jdbcDialectProfile(profile.name),
      lspServerDialect:
        JDBC_REFERENCE_LSP_SERVER_DIALECTS[driver] ??
        jdbcDialectProfile(profile.name).lspServerDialect,
    });
  }

  assert.equal(Object.keys(JDBC_REFERENCE_DIALECT_PROFILE_NAMES).length, 49);
  assert.equal(jdbcDialectProfile("generic").supportsDatabaseCatalogs, false);
  assert.equal(jdbcDialectProfile("oracle").supportsDatabaseCatalogs, false);
  assert.equal(jdbcDialectProfile("hive").supportsDatabaseCatalogs, false);
  assert.equal(jdbcDialectProfile("sqlserver").supportsDatabaseCatalogs, true);
  assert.equal(jdbcDialectProfile("postgres").supportsDatabaseCatalogs, true);
  assert.equal(jdbcDialectProfile("mysql").supportsDatabaseCatalogs, true);
});

test("writes a conservative JDBC capability contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oxide-jdbc-capabilities-"));
  const output = join(directory, "trino.json");
  const result = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "trino",
    "--display-name", "Trino",
    "--out", output,
    "--dialect-profile", "hive",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const capabilities = JSON.parse(await readFile(output, "utf8"));
  assert.equal(capabilities.driver, "trino");
  assert.equal(capabilities.lspLanguageId, "hive");
  assert.equal(capabilities.lspServerDialect, "hive");
  assert.equal(capabilities.namespaceLabel, "database");
  assert.equal(capabilities.defaultPort, 10000);
  assert.equal(capabilities.identifierQuote, "`");
  assert.equal(capabilities.supportsTableRowMutation, false);
  assert.equal(capabilities.supportsTableDataTransfer, false);
  assert.deepEqual(capabilities.tableExportFormats, []);
  assert.equal(capabilities.supportsTableConstraints, false);
  assert.equal(capabilities.supportsTransactions, false);
  assert.equal(capabilities.supportsDatabaseCatalogs, false);

  const argoOutput = join(directory, "argo.json");
  const argoResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "argo",
    "--display-name", "ArgoDB (Transwarp)",
    "--out", argoOutput,
    "--reference-driver", "argo",
  ], { encoding: "utf8" });
  assert.equal(argoResult.status, 0, argoResult.stderr);
  const argoCapabilities = JSON.parse(await readFile(argoOutput, "utf8"));
  assert.equal(argoCapabilities.lspLanguageId, "sql");
  assert.equal(argoCapabilities.lspServerDialect, "argo");
  assert.equal(argoCapabilities.namespaceLabel, "database");
  assert.equal(argoCapabilities.identifierQuote, "`");
  assert.equal(argoCapabilities.defaultPort, 10000);

  const sqlServerOutput = join(directory, "sqlserver.json");
  const sqlServerResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "sqlserver",
    "--display-name", "Microsoft SQL Server",
    "--out", sqlServerOutput,
    "--dialect-profile", "sqlserver",
  ], { encoding: "utf8" });
  assert.equal(sqlServerResult.status, 0, sqlServerResult.stderr);
  const sqlServerCapabilities = JSON.parse(await readFile(sqlServerOutput, "utf8"));
  assert.equal(sqlServerCapabilities.identifierQuote, "[");
  assert.equal(sqlServerCapabilities.lspLanguageId, "sql");
  assert.equal(sqlServerCapabilities.lspServerDialect, "sqlserver");
  assert.equal(sqlServerCapabilities.supportsDatabaseCatalogs, true);

  const redshiftOutput = join(directory, "redshift.json");
  const redshiftResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "redshift",
    "--display-name", "Amazon Redshift",
    "--out", redshiftOutput,
    "--reference-driver", "redshift",
  ], { encoding: "utf8" });
  assert.equal(redshiftResult.status, 0, redshiftResult.stderr);
  const redshiftCapabilities = JSON.parse(await readFile(redshiftOutput, "utf8"));
  assert.equal(redshiftCapabilities.identifierQuote, '"');
  assert.equal(redshiftCapabilities.namespaceLabel, "schema");
  assert.equal(redshiftCapabilities.defaultPort, 5432);
  assert.equal(redshiftCapabilities.lspLanguageId, "sql");
  assert.equal(redshiftCapabilities.lspServerDialect, "redshift");

  const incompatibleProfileResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "invalid",
    "--display-name", "Invalid",
    "--out", join(directory, "invalid.json"),
    "--reference-driver", "redshift",
    "--dialect-profile", "generic",
  ], { encoding: "utf8" });
  assert.notEqual(incompatibleProfileResult.status, 0);
  assert.match(
    incompatibleProfileResult.stderr,
    /either --reference-driver or --dialect-profile/u,
  );

  const mismatchedReferenceResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "oracle",
    "--display-name", "Oracle Database",
    "--out", join(directory, "oracle.json"),
    "--reference-driver", "redshift",
  ], { encoding: "utf8" });
  assert.notEqual(mismatchedReferenceResult.status, 0);
  assert.match(
    mismatchedReferenceResult.stderr,
    /--reference-driver must match --driver/u,
  );

  const h2Output = join(directory, "h2.json");
  const h2Result = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "h2",
    "--display-name", "H2",
    "--out", h2Output,
    "--dialect-profile", "h2",
    "--supports-table-constraints",
    "--supports-create-namespace",
  ], { encoding: "utf8" });
  assert.equal(h2Result.status, 0, h2Result.stderr);
  const h2Capabilities = JSON.parse(await readFile(h2Output, "utf8"));
  assert.equal(h2Capabilities.supportsTableConstraints, true);
  assert.equal(h2Capabilities.supportsCreateDatabase, true);
  assert.equal(h2Capabilities.supportsDatabaseCatalogs, true);

  const postgresOutput = join(directory, "postgres.json");
  const postgresResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "postgres",
    "--display-name", "PostgreSQL",
    "--out", postgresOutput,
    "--dialect-profile", "postgres",
  ], { encoding: "utf8" });
  assert.equal(postgresResult.status, 0, postgresResult.stderr);
  const postgresCapabilities = JSON.parse(await readFile(postgresOutput, "utf8"));
  assert.deepEqual(
    postgresCapabilities.tableExportFormats,
    ["csv", "json", "jsonl", "sql", "tsv", "xlsx"],
  );
  assert.equal(postgresCapabilities.supportsDatabaseCatalogs, true);

  const oracleOutput = join(directory, "oracle-profile.json");
  const oracleResult = spawnSync(process.execPath, [
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "oracle",
    "--display-name", "Oracle Database",
    "--out", oracleOutput,
    "--reference-driver", "oracle",
  ], { encoding: "utf8" });
  assert.equal(oracleResult.status, 0, oracleResult.stderr);
  const oracleCapabilities = JSON.parse(await readFile(oracleOutput, "utf8"));
  assert.equal(oracleCapabilities.namespaceLabel, "schema");
  assert.equal(oracleCapabilities.supportsDatabaseCatalogs, false);
});
