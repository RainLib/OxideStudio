import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/database.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["capabilities", "models", "namespace", "packages", "runtime"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

const stableExports = [
  "ConnectionDatabaseCapabilityContext",
  "DatabaseDriverCatalog",
  "DatabaseDriverInstallation",
  "DatabaseDriverProbeResult",
  "DatabaseDriverRuntimeReconnectResult",
  "DatabaseDriverRuntimeSummary",
  "DatabaseDriverStoreInfo",
  "SchemaMigrationCapabilityMode",
];
if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  stableExports.some((symbol) => !new RegExp(`\\b${symbol}\\b`).test(facade))
) throw new Error(`${entry}: retain the module-only database-command facade and stable response exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/database/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::database(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning database-command module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown database-command dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate database-command owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  typeMethods += [...source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}

assertAcyclic(graph, "Rust database command module");
for (const [symbol, owner] of Object.entries({
  DatabaseDriverInstallation: "models",
  ConnectionDatabaseCapabilityContext: "models",
  DatabaseDriverRuntimeSummary: "models",
  bundled_database_driver_installations: "capabilities",
  resolved_database_capabilities: "capabilities",
  external_driver_installation: "packages",
  ensure_active_package_can_change: "packages",
  create_database_sql: "namespace",
  ensure_host_managed_namespace_mutation: "namespace",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

const commandOwners = {
  capabilities: [
    "get_database_capabilities",
    "get_connection_database_capability_context",
    "list_database_capabilities",
  ],
  packages: [
    "list_database_driver_installations",
    "get_external_database_driver_catalog",
    "install_external_database_driver",
    "install_external_database_driver_from_catalog",
    "activate_external_database_driver",
    "rollback_external_database_driver",
    "probe_external_database_driver",
  ],
  runtime: [
    "list_external_database_driver_runtimes",
    "reconnect_external_database_driver_runtimes",
    "get_database_driver_store_info",
    "prune_database_driver_cache",
    "migrate_database_driver_store",
    "list_managed_java_runtimes",
    "install_managed_java_runtime",
  ],
  namespace: ["create_database", "drop_database", "rename_database"],
};
const lib = readSourceText(path.join(root, "src-tauri/src/lib.rs"));
let commands = 0;
for (const [module, symbols] of Object.entries(commandOwners)) {
  const source = readSourceText(path.join(root, `src-tauri/src/commands/database/${module}.rs`));
  for (const symbol of symbols) {
    if (!new RegExp(`#\\[tauri::command\\]\\s+pub async fn ${symbol}\\b`).test(source))
      throw new Error(`${symbol} must remain a Tauri command in ${module}.`);
    if (!new RegExp(`\\bcommands::database::${module}::${symbol},`).test(lib))
      throw new Error(`${symbol} must be registered directly from database::${module}.`);
    commands++;
  }
}

if (helpers !== 41 || typeMethods !== 2 || commands !== 20)
  throw new Error(`Expected 41 database-command helpers, 2 type methods, and 20 Tauri commands; found ${helpers}, ${typeMethods}, and ${commands}.`);

const tests = readSourceText(path.join(root, "src-tauri/src/commands/database/tests.rs"));
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 15) throw new Error(`Expected 15 database-command regression scenarios; found ${testCount}.`);

console.log(`Rust database command boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${commands} Tauri commands, ${testCount} tests, acyclic imports.`);
