import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/core/store.rs";
const facade = readSourceText(path.join(root, entry));
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 14 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use models::{") ||
  !facade.includes("MetaStore")
) throw new Error(`${entry}: retain the model exports and module-only facade.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let functions = 0;
let storeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/core/store/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::core::store::/.test(source))
    throw new Error(`${file}: import directly from the owning store module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown store dependency ${match[1]}.`);
    deps.add(match[1]);
  }
  graph.set(module, deps);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate store owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) functions++;
  }
  if (source.includes("impl MetaStore {")) {
    for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate MetaStore method owners.`);
      definitions.set(match[1], module);
      storeMethods++;
    }
  }
}
assertAcyclic(graph, "Rust MetaStore");
for (const [symbol, owner] of Object.entries({
  MetaStore: "models", SavedConnection: "models", Resource: "models",
  AssistantTaskRecord: "models", default_project_id: "models",
  ProtectedConnectionCredentials: "credential_crypto",
  extract_ssh_tunnel_secrets: "credential_crypto",
  restore_connection_config_with_key: "credential_crypto",
  restore_read_only_connection_credentials: "credential_crypto",
  validate_cli_capability_cache_identity: "cache_policy",
  validate_assistant_task: "assistant_validation",
  new: "setup", open: "setup", get_cli_capability_cache: "cache",
  record_driver_runtime_event: "telemetry",
  migrate_connections_project_scope: "migrations",
  save_project: "projects", save_connection: "connections",
  save_saved_sql_batch: "saved_sql", save_query_history: "history",
  save_assistant_task: "assistant", replace_resources: "resources",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);
if (functions !== 17 || storeMethods !== 46)
  throw new Error(`Expected 17 store helpers and 46 MetaStore methods; found ${functions} and ${storeMethods}.`);
const tests = ["cache", "telemetry", "connections", "history", "assistant", "saved_sql"];
const testFolder = path.join(root, "src-tauri/src/core/store/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("MetaStore tests must remain split by scenario.");
console.log(`Rust MetaStore boundaries verified: ${modules.length} modules, ${functions} helpers, ${storeMethods} methods, six test modules, acyclic imports.`);
