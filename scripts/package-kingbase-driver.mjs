#!/usr/bin/env node

/** Builds the unsigned, reviewable Kingbase native sidecar payload. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const driverRoot = join(root, "src-tauri", "drivers", "kingbase");
const defaultTarget = process.platform === "win32" ? "x86_64-pc-windows-msvc" : process.platform === "darwin" ? "aarch64-apple-darwin" : "x86_64-unknown-linux-gnu";
const CAPABILITIES = {
  driver: "kingbase", displayName: "KingbaseES", dataModel: "relational", connectionMode: "network",
  lspLanguageId: "sql", namespaceLabel: "schema", identifierQuote: '"', defaultPort: 54321,
  supportsSqlQuery: true, supportsTableBrowsing: true, tableExportFormats: [], supportsTableRowMutation: false, supportsTableDdl: false,
  supportsColumnAlteration: false, supportsIndexRename: false, supportsConstraintAlteration: false, supportsCollectionBrowsing: false,
  supportsKeyValueBrowsing: false, supportsSchemas: true, supportsDatabaseCatalogs: true, supportsConnectionDatabase: true,
  supportsCreateDatabase: false, supportsCreateDatabaseOwner: false, supportsCreateDatabaseCharset: false, supportsCreateDatabaseCollation: false,
  supportsColumnComments: false, supportsInlineColumnComments: false, supportsRenameDatabase: false, supportsViews: true, supportsReplaceView: false,
  supportsMaterializedViews: false, supportsTableIndexes: true, supportsTableConstraints: true, supportsForeignKeys: true, supportsCheckConstraints: true,
  supportsFunctions: true, supportsTransactions: false, supportsQueryCancellation: true, autoIncrementKeyword: null, defaultPrimaryKeyType: "",
};
function option(name) { const i = process.argv.indexOf(name); if (i < 0) return null; const v = process.argv[i + 1]; if (!v || v.startsWith("--")) throw new Error(`${name} requires a value`); return v; }
async function hash(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function main() {
  const target = option("--target") || defaultTarget; const version = option("--version") || "0.1.0";
  const executable = target.includes("windows") ? "oxide-driver-kingbase.exe" : "oxide-driver-kingbase";
  const binary = resolve(option("--binary") || join(driverRoot, "dist", target, executable));
  const output = resolve(option("--out") || join(root, "artifacts", "drivers", "kingbase", version, target));
  if (!(await stat(binary).catch(() => null))?.isFile()) throw new Error(`Kingbase driver binary was not found: ${binary}`);
  if (await stat(output).catch(() => null)) throw new Error(`Refusing to overwrite an existing driver package: ${output}`);
  await mkdir(output, { recursive: true }); const entry = join(output, executable); await copyFile(binary, entry);
  const manifest = { schemaVersion: 1, packageId: "oxide.kingbase", packageVersion: version, protocolVersion: "1.0", driverId: "kingbase", displayName: "KingbaseES", clientLibrary: "gokb", clientVersion: "20201021123113", entrypoint: basename(entry), sha256: await hash(entry), supportedTargets: [target], serverVersionRange: null, capabilities: CAPABILITIES };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Unsigned Kingbase package prepared at ${output}`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
