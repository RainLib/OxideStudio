#!/usr/bin/env node

/**
 * Writes a conservative capability contract for a generic JDBC package.
 *
 * This intentionally creates a read/query/metadata profile only. A package
 * author must build a dedicated sidecar and conformance fixtures before
 * enabling Grid writes, table transfer, DDL, or transaction claims.
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  JDBC_DIALECT_PROFILES,
  jdbcDialectProfile,
  jdbcReferenceDialectProfile,
} from "./driver-dialect-profiles.mjs";

const SQL_LSP_LANGUAGES = new Set(["sql", "postgres", "mysql", "sqlite", "duckdb", "hive"]);
const NAMESPACE_LABELS = new Set(["schema", "database", "catalog"]);
const HOST_TABLE_EXPORT_FORMATS = ["csv", "json", "jsonl", "sql", "tsv", "xlsx"];

function option(name, required = false) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function flag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Usage: node scripts/create-jdbc-driver-capabilities.mjs --driver <id> --display-name <name> --out <capabilities.json> [--reference-driver <catalog-id> | --dialect-profile generic] [--lsp-language-id sql] [--namespace-label schema] [--identifier-quote '\"'] [--default-port 0] [--supports-table-constraints] [--supports-create-namespace]\nProfiles: ${Object.keys(JDBC_DIALECT_PROFILES).join(", ")}`);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }
  const driver = option("--driver", true);
  const displayName = option("--display-name", true).trim();
  const output = resolve(option("--out", true));
  const referenceDriver = option("--reference-driver");
  const explicitProfile = option("--dialect-profile");
  if (referenceDriver && explicitProfile) {
    throw new Error("Use either --reference-driver or --dialect-profile, not both");
  }
  const profile = referenceDriver
    ? jdbcReferenceDialectProfile(referenceDriver)
    : jdbcDialectProfile(explicitProfile || "generic");
  const lspLanguageId = (option("--lsp-language-id") || profile.lspLanguageId).trim().toLowerCase();
  const lspServerDialect = profile.lspServerDialect;
  const namespaceLabel = (option("--namespace-label") || profile.namespaceLabel).trim().toLowerCase();
  const identifierQuote = option("--identifier-quote") ?? profile.identifierQuote;
  const defaultPort = Number.parseInt(option("--default-port") || String(profile.defaultPort), 10);

  if (!/^[A-Za-z0-9._-]{1,96}$/.test(driver)) {
    throw new Error("--driver must be a safe driver id");
  }
  if (
    referenceDriver &&
    driver.trim().toLowerCase() !== referenceDriver.trim().toLowerCase()
  ) {
    throw new Error("--reference-driver must match --driver");
  }
  if (!displayName || displayName.length > 160) {
    throw new Error("--display-name must be between 1 and 160 characters");
  }
  if (!SQL_LSP_LANGUAGES.has(lspLanguageId)) {
    throw new Error(`--lsp-language-id must be one of: ${[...SQL_LSP_LANGUAGES].join(", ")}`);
  }
  if (!NAMESPACE_LABELS.has(namespaceLabel)) {
    throw new Error("--namespace-label must be schema, database, or catalog");
  }
  if (!Number.isInteger(defaultPort) || defaultPort < 0 || defaultPort > 65535) {
    throw new Error("--default-port must be an integer between 0 and 65535");
  }
  if (identifierQuote.length > 1) {
    throw new Error("--identifier-quote must be one character or empty");
  }
  if (await stat(output).catch(() => null)) {
    throw new Error(`Refusing to overwrite an existing capability contract: ${output}`);
  }

  const capabilities = {
    driver,
    displayName,
    dataModel: "relational",
    connectionMode: "network",
    lspLanguageId,
    lspServerDialect,
    namespaceLabel,
    identifierQuote,
    defaultPort,
    supportsSqlQuery: true,
    supportsTableBrowsing: true,
    tableExportFormats: ["postgres", "mysql", "sqlite", "duckdb"].includes(lspLanguageId)
      ? HOST_TABLE_EXPORT_FORMATS
      : [],
    supportsTableRowMutation: false,
    supportsTableDataTransfer: false,
    supportsTableDdl: false,
    supportsColumnAlteration: false,
    supportsIndexRename: false,
    supportsConstraintAlteration: false,
    supportsCollectionBrowsing: false,
    supportsKeyValueBrowsing: false,
    supportsSchemas: true,
    // Catalogs are a distinct level above schemas only for profiles that
    // explicitly declare them. Treating every JDBC DatabaseMetaData#getCatalogs
    // implementation as a usable product catalog creates duplicate/empty tree
    // levels for Oracle, Hive and generic JDBC packages.
    supportsDatabaseCatalogs: profile.supportsDatabaseCatalogs,
    supportsConnectionDatabase: true,
    // The generic Agent implements a semantic namespace request, but it is
    // off by default. Enabling it never permits Host-generated CREATE SQL;
    // package signing plus the Agent's namespace-kind validation remain the
    // execution boundary.
    supportsCreateDatabase: flag("--supports-create-namespace"),
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
    // JDBC provides portable primary-key and foreign-key metadata. Keep the
    // full constraints tree opt-in because CHECK/UNIQUE definitions are not
    // consistently available from DatabaseMetaData across vendors.
    supportsTableConstraints: flag("--supports-table-constraints"),
    supportsForeignKeys: true,
    supportsCheckConstraints: false,
    supportsFunctions: true,
    supportsTransactions: false,
    supportsQueryCancellation: true,
    supportsExplainPlan: false,
    autoIncrementKeyword: null,
    defaultPrimaryKeyType: "",
    commonDataTypes: ["VARCHAR", "INTEGER", "BIGINT", "DECIMAL", "BOOLEAN", "DATE", "TIMESTAMP"],
  };

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(capabilities, null, 2)}\n`, "utf8");
  console.log(`Conservative JDBC capability contract written to ${output}`);
  console.log("Review it, package it with vendor JARs, then sign the resulting manifest before import.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
