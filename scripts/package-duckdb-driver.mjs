#!/usr/bin/env node

/**
 * Builds the unsigned, reviewable payload for the DuckDB external driver.
 *
 * Signing intentionally remains a separate release-key operation. Production
 * builds reject unsigned payloads, so this script never presents its output as
 * installable until `manifest.json` receives its detached Minisign signature.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driverRoot = join(repositoryRoot, "src-tauri", "crates", "oxide-driver-duckdb");
const defaultTarget = process.platform === "darwin"
  ? process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  : process.platform === "win32"
    ? process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
    : process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";

const CAPABILITIES = {
  driver: "duckdb",
  displayName: "DuckDB",
  dataModel: "relational",
  connectionMode: "file",
  // DuckDB is exposed as its own language identity. The bundled LSP resolves
  // it to the SQLite-compatible completion baseline until a native grammar is
  // shipped, rather than silently falling back to generic SQL.
  lspLanguageId: "duckdb",
  namespaceLabel: "schema",
  identifierQuote: '"',
  defaultPort: 0,
  supportsSqlQuery: true,
  supportsTableBrowsing: true,
  tableExportFormats: ["csv", "json", "jsonl", "sql", "tsv", "xlsx"],
  supportsTableRowMutation: false,
  // Copying a bounded table page through a target-side transaction is a
  // reviewed capability distinct from interactive Grid mutations.
  supportsTableDataTransfer: true,
  supportsTableDdl: false,
  supportsColumnAlteration: false,
  supportsIndexRename: false,
  supportsConstraintAlteration: false,
  supportsCollectionBrowsing: false,
  supportsKeyValueBrowsing: false,
  supportsSchemas: true,
  supportsDatabaseCatalogs: true,
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
  supportsCheckConstraints: true,
  supportsFunctions: false,
  supportsTransactions: true,
  supportsQueryCancellation: false,
  supportsExplainPlan: false,
  autoIncrementKeyword: null,
  defaultPrimaryKeyType: "BIGINT",
  commonDataTypes: [
    "BOOLEAN", "TINYINT", "INTEGER", "BIGINT", "REAL", "DOUBLE",
    "DECIMAL", "VARCHAR", "DATE", "TIMESTAMP", "JSON",
  ],
};

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function printUsage() {
  console.log(
    "Usage: node scripts/package-duckdb-driver.mjs --target <rust-target> [--binary <path>] [--out <directory>] [--version <package-version>]",
  );
}

async function crateVersion() {
  const cargoToml = await readFile(join(driverRoot, "Cargo.toml"), "utf8");
  const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error("Unable to read DuckDB package version from Cargo.toml");
  return version;
}

async function duckdbClientVersion() {
  const lockfile = await readFile(join(driverRoot, "Cargo.lock"), "utf8");
  const match = lockfile.match(/\[\[package\]\]\r?\nname = "duckdb"\r?\nversion = "([^"]+)"/);
  if (!match) throw new Error("Unable to read duckdb client version from Cargo.lock");
  return match[1];
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }
  const requestedTarget = readOption("--target");
  const target = requestedTarget || defaultTarget;
  const version = readOption("--version") || await crateVersion();
  const executableName = target.includes("windows")
    ? "oxide-driver-duckdb.exe"
    : "oxide-driver-duckdb";
  const defaultBinary = requestedTarget
    ? join(driverRoot, "target", target, "release", executableName)
    : join(driverRoot, "target", "release", executableName);
  const binary = resolve(readOption("--binary") || defaultBinary);
  const output = resolve(readOption("--out") || join(repositoryRoot, "artifacts", "drivers", "duckdb", version, target));
  const input = await stat(binary).catch(() => null);
  if (!input?.isFile()) {
    throw new Error(`DuckDB driver binary was not found: ${binary}`);
  }
  const outputEntry = join(output, executableName);
  const destination = await stat(output).catch(() => null);
  if (destination) {
    throw new Error(`Refusing to overwrite an existing driver package: ${output}`);
  }
  await mkdir(output, { recursive: true });
  await copyFile(binary, outputEntry);
  const manifest = {
    schemaVersion: 1,
    packageId: "oxide.duckdb",
    packageVersion: version,
    protocolVersion: "1.0",
    driverId: "duckdb",
    displayName: "DuckDB",
    clientLibrary: "duckdb-rs",
    clientVersion: await duckdbClientVersion(),
    entrypoint: basename(outputEntry),
    sha256: await sha256(outputEntry),
    supportedTargets: [target],
    serverVersionRange: null,
    capabilities: CAPABILITIES,
  };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Unsigned DuckDB package prepared at ${output}`);
  console.log("Sign exactly manifest.json as manifest.json.minisig with the official driver release key before installation.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
