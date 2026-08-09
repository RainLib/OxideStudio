#!/usr/bin/env node

/**
 * Builds the unsigned, reviewable payload for the RQLite HTTP sidecar.
 *
 * Signing deliberately happens after this step with the official driver
 * release key. The application rejects unsigned payloads in production.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driverRoot = join(repositoryRoot, "src-tauri", "crates", "oxide-driver-rqlite");
const defaultTarget = process.platform === "darwin"
  ? process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  : process.platform === "win32"
    ? process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
    : process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";

const CAPABILITIES = {
  driver: "rqlite",
  displayName: "RQLite",
  dataModel: "relational",
  connectionMode: "network",
  // RQLite uses SQLite syntax. This deliberately selects the existing SQLite
  // completion profile rather than pretending there is a bespoke RQLite LSP.
  lspLanguageId: "sqlite",
  namespaceLabel: "schema",
  identifierQuote: '"',
  defaultPort: 4001,
  supportsSqlQuery: true,
  supportsTableBrowsing: true,
  tableExportFormats: ["csv", "json", "jsonl", "sql", "tsv", "xlsx"],
  supportsTableRowMutation: false,
  supportsTableDdl: false,
  supportsColumnAlteration: false,
  supportsIndexRename: false,
  supportsConstraintAlteration: false,
  supportsCollectionBrowsing: false,
  supportsKeyValueBrowsing: false,
  supportsSchemas: true,
  supportsDatabaseCatalogs: false,
  supportsConnectionDatabase: false,
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
  supportsCheckConstraints: false,
  supportsFunctions: false,
  supportsTransactions: false,
  supportsQueryCancellation: false,
  supportsExplainPlan: false,
  autoIncrementKeyword: "AUTOINCREMENT",
  defaultPrimaryKeyType: "INTEGER",
  commonDataTypes: [
    "INTEGER", "REAL", "TEXT", "BLOB", "NUMERIC", "BOOLEAN", "DATE", "DATETIME", "JSON",
  ],
};

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function printUsage() {
  console.log(
    "Usage: node scripts/package-rqlite-driver.mjs --target <rust-target> [--binary <path>] [--out <directory>] [--version <package-version>]",
  );
}

async function crateVersion() {
  const cargoToml = await readFile(join(driverRoot, "Cargo.toml"), "utf8");
  const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error("Unable to read RQLite package version from Cargo.toml");
  return version;
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
  const executableName = target.includes("windows") ? "oxide-driver-rqlite.exe" : "oxide-driver-rqlite";
  const defaultBinary = requestedTarget
    ? join(driverRoot, "target", target, "release", executableName)
    : join(driverRoot, "target", "release", executableName);
  const binary = resolve(readOption("--binary") || defaultBinary);
  const output = resolve(readOption("--out") || join(repositoryRoot, "artifacts", "drivers", "rqlite", version, target));
  if (!(await stat(binary).catch(() => null))?.isFile()) {
    throw new Error(`RQLite driver binary was not found: ${binary}`);
  }
  if (await stat(output).catch(() => null)) {
    throw new Error(`Refusing to overwrite an existing driver package: ${output}`);
  }
  await mkdir(output, { recursive: true });
  const outputEntry = join(output, executableName);
  await copyFile(binary, outputEntry);
  const manifest = {
    schemaVersion: 1,
    packageId: "oxide.rqlite",
    packageVersion: version,
    protocolVersion: "1.0",
    driverId: "rqlite",
    displayName: "RQLite",
    clientLibrary: "rqlite-http-api",
    clientVersion: "HTTP API",
    entrypoint: basename(outputEntry),
    sha256: await sha256(outputEntry),
    supportedTargets: [target],
    serverVersionRange: null,
    capabilities: CAPABILITIES,
  };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Unsigned RQLite package prepared at ${output}`);
  console.log("Sign exactly manifest.json as manifest.json.minisig with the official driver release key before installation.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
