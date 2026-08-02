#!/usr/bin/env node

/**
 * Packages the portable Oxide JDBC Agent with one or more vendor JDBC JARs.
 * Every JAR is copied into the signed package manifest with its own SHA-256;
 * the Host then launches it only through the managed Java 21 runtime.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function option(name, required = false) { const index = process.argv.indexOf(name); const value = index < 0 ? null : process.argv[index + 1]; if (index >= 0 && (!value || value.startsWith("--"))) throw new Error(`${name} requires a value`); if (required && !value) throw new Error(`${name} is required`); return value; }
function all(name) { return process.argv.flatMap((value, index) => value === name && process.argv[index + 1] && !process.argv[index + 1].startsWith("--") ? [process.argv[index + 1]] : []); }
async function digest(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }
async function file(path, label) { if (!(await stat(path).catch(() => null))?.isFile()) throw new Error(`${label} was not found: ${path}`); }
function serverVersionRange(value) {
  if (!value) return null;
  const range = value.trim();
  if (!range || range.length > 512) throw new Error("--server-version-range is invalid");
  const comparator = /(>=|<=|>|<|=)\s*(\d+(?:\.\d+){0,2})/g;
  let cursor = 0;
  let found = 0;
  for (const match of range.matchAll(comparator)) {
    if (!range.slice(cursor, match.index).split("").every((character) => /\s|,/.test(character))) {
      throw new Error("--server-version-range uses unsupported syntax");
    }
    cursor = (match.index || 0) + match[0].length;
    found += 1;
  }
  if (!found || !range.slice(cursor).split("").every((character) => /\s|,/.test(character))) {
    throw new Error("--server-version-range uses unsupported syntax");
  }
  return range;
}
function validateGenericJdbcCapabilities(capabilities, driver) {
  if (capabilities.driver !== driver) throw new Error("Capabilities driver must match --driver");
  if (capabilities.dataModel !== "relational") throw new Error("The generic JDBC Agent only packages relational drivers; document, graph, time-series, coordination, and queue products require a dedicated sidecar workspace");
  if (capabilities.supportsCollectionBrowsing === true || capabilities.supportsKeyValueBrowsing === true) throw new Error("The generic JDBC Agent cannot declare collection or key-value browsing");
  if (capabilities.supportsTransactions === true) throw new Error("The generic JDBC Agent does not provide interactive transaction sessions");
  if (capabilities.supportsTableRowMutation === true) throw new Error("The generic JDBC Agent does not provide bounded Grid row mutation");
  if (capabilities.supportsTableDataTransfer === true) throw new Error("The generic JDBC Agent does not provide reviewed cross-connection table data transfer");
  if (capabilities.supportsTableDdl === true || capabilities.supportsColumnAlteration === true || capabilities.supportsIndexRename === true || capabilities.supportsConstraintAlteration === true) throw new Error("The generic JDBC Agent cannot declare bounded Table Editor DDL capabilities");
  if (capabilities.supportsCreateDatabase === true) {
    const namespace = String(capabilities.namespaceLabel || "").trim().toLowerCase();
    if (namespace !== "schema" && namespace !== "database") throw new Error("Generic JDBC namespace creation requires a schema or database namespaceLabel");
    if (capabilities.supportsCreateDatabaseOwner === true || capabilities.supportsCreateDatabaseCharset === true || capabilities.supportsCreateDatabaseCollation === true) throw new Error("The generic JDBC Agent cannot declare owner, charset, or collation namespace options");
  }
}
async function main() {
  if (process.argv.includes("--help")) { console.log("Usage: node scripts/package-jdbc-driver.mjs --driver <id> --display-name <name> --client-library <name> --client-version <version> --agent <oxide-jdbc-agent.jar> --classpath <vendor.jar> [--classpath <extra.jar>] --capabilities <json> --out <dir> [--version 1.0.0] [--server-version-range '>= 2 < 3'] [--connection-url-template <template>]"); return; }
  const driver = option("--driver", true); const displayName = option("--display-name", true); const clientLibrary = option("--client-library", true); const clientVersion = option("--client-version", true);
  const agent = resolve(option("--agent", true)); const classpath = all("--classpath").map((value) => resolve(value)); const capabilityFile = resolve(option("--capabilities", true)); const output = resolve(option("--out", true)); const version = option("--version") || "0.1.0";
  const connectionUrlTemplate = option("--connection-url-template");
  const supportedServerVersions = serverVersionRange(option("--server-version-range"));
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(driver)) throw new Error("--driver must be a safe driver id"); if (!classpath.length) throw new Error("At least one --classpath vendor JAR is required");
  await file(agent, "JDBC Agent"); for (const path of classpath) await file(path, "JDBC classpath entry");
  const capabilities = JSON.parse(await readFile(capabilityFile, "utf8")); validateGenericJdbcCapabilities(capabilities, driver);
  if (await stat(output).catch(() => null)) throw new Error(`Refusing to overwrite an existing driver package: ${output}`);
  await mkdir(join(output, "lib"), { recursive: true }); const entrypoint = "oxide-jdbc-agent.jar"; await copyFile(agent, join(output, entrypoint));
  const used = new Set(); const entries = [];
  for (const source of classpath) { const name = basename(source); if (used.has(name)) throw new Error(`Classpath basenames must be unique: ${name}`); used.add(name); const path = `lib/${name}`; const destination = join(output, path); await copyFile(source, destination); entries.push({ path, sha256: await digest(destination) }); }
  const manifest = { schemaVersion: 1, packageId: `oxide.jdbc.${driver}`, packageVersion: version, protocolVersion: "1.0", driverId: driver, displayName, clientLibrary, clientVersion, entrypoint, sha256: await digest(join(output, entrypoint)), supportedTargets: ["*"], serverVersionRange: supportedServerVersions, connectionUrlTemplate: connectionUrlTemplate || null, runtime: { kind: "java", javaMajor: 21, mainClass: "studio.oxide.jdbc.DriverMain", classpath: entries }, capabilities };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8"); console.log(`Unsigned JDBC driver package prepared at ${output}`); console.log("Sign exactly manifest.json as manifest.json.minisig with the official driver release key before installation.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
