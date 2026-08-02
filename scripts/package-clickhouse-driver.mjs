#!/usr/bin/env node

/** Builds the unsigned, reviewable ClickHouse HTTP sidecar release payload. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driverRoot = join(repositoryRoot, "src-tauri", "crates", "oxide-driver-clickhouse");
const defaultTarget = process.platform === "darwin"
  ? process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  : process.platform === "win32"
    ? process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
    : process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";

const CAPABILITIES = {
  driver: "clickhouse", displayName: "ClickHouse", dataModel: "relational", connectionMode: "network",
  // DBX's ClickHouse descriptor uses ANSI double quotes. ClickHouse accepts
  // them in its standard parser mode, so use that portable form instead of
  // leaking a MySQL-specific backtick preference into shared UI quoting.
  lspLanguageId: "clickhouse", namespaceLabel: "database", identifierQuote: '"', defaultPort: 8123,
  supportsSqlQuery: true, supportsTableBrowsing: true, supportsTableRowMutation: false, supportsTableDdl: false,
  supportsColumnAlteration: false, supportsIndexRename: false, supportsConstraintAlteration: false,
  supportsCollectionBrowsing: false, supportsKeyValueBrowsing: false, supportsSchemas: true, supportsDatabaseCatalogs: true,
  supportsConnectionDatabase: true, supportsCreateDatabase: false, supportsCreateDatabaseOwner: false,
  supportsCreateDatabaseCharset: false, supportsCreateDatabaseCollation: false, supportsColumnComments: true,
  supportsInlineColumnComments: true, supportsRenameDatabase: false, supportsViews: true, supportsReplaceView: false,
  supportsMaterializedViews: false, supportsTableIndexes: true, supportsTableConstraints: false, supportsForeignKeys: false,
  supportsCheckConstraints: false, supportsFunctions: false, supportsTransactions: false, supportsQueryCancellation: false,
  supportsExplainPlan: false, autoIncrementKeyword: null, defaultPrimaryKeyType: "",
  commonDataTypes: ["UInt8", "UInt64", "Int64", "Float64", "Decimal", "String", "FixedString", "Date", "DateTime", "DateTime64", "UUID", "JSON", "Array", "Map", "Tuple"],
};

function readOption(name) { const index = process.argv.indexOf(name); if (index < 0) return null; const value = process.argv[index + 1]; if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`); return value; }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function crateVersion() { const source = await readFile(join(driverRoot, "Cargo.toml"), "utf8"); const version = source.match(/^version\s*=\s*"([^"]+)"/m)?.[1]; if (!version) throw new Error("Unable to read ClickHouse package version from Cargo.toml"); return version; }
async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) { console.log("Usage: node scripts/package-clickhouse-driver.mjs --target <rust-target> [--binary <path>] [--out <directory>] [--version <package-version>]"); return; }
  const requestedTarget = readOption("--target"); const target = requestedTarget || defaultTarget; const version = readOption("--version") || await crateVersion();
  const executableName = target.includes("windows") ? "oxide-driver-clickhouse.exe" : "oxide-driver-clickhouse";
  const binary = resolve(readOption("--binary") || (requestedTarget ? join(driverRoot, "target", target, "release", executableName) : join(driverRoot, "target", "release", executableName)));
  const output = resolve(readOption("--out") || join(repositoryRoot, "artifacts", "drivers", "clickhouse", version, target));
  if (!(await stat(binary).catch(() => null))?.isFile()) throw new Error(`ClickHouse driver binary was not found: ${binary}`);
  if (await stat(output).catch(() => null)) throw new Error(`Refusing to overwrite an existing driver package: ${output}`);
  await mkdir(output, { recursive: true }); const entry = join(output, executableName); await copyFile(binary, entry);
  await writeFile(join(output, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, packageId: "oxide.clickhouse", packageVersion: version, protocolVersion: "1.0", driverId: "clickhouse", displayName: "ClickHouse", clientLibrary: "clickhouse-http-api", clientVersion: "HTTP API", entrypoint: basename(entry), sha256: await sha256(entry), supportedTargets: [target], serverVersionRange: null, capabilities: CAPABILITIES }, null, 2)}\n`, "utf8");
  console.log(`Unsigned ClickHouse package prepared at ${output}`); console.log("Sign exactly manifest.json as manifest.json.minisig with the official driver release key before installation.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
