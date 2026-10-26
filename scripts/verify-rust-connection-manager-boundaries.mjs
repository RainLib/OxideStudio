import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/core/manager.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["lifecycle", "models", "operations"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|impl)\b/m.test(facade) ||
  !facade.includes("ConnectionManager") ||
  !facade.includes("LiveConnectionCapabilitySnapshot")
) throw new Error(`${entry}: retain a module-only connection-manager facade and stable public models.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let methods = 0;
for (const module of modules) {
  const file = `src-tauri/src/core/manager/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::core::manager::/.test(source))
    throw new Error(`${file}: import directly from its connection-manager owner.`);
  const dependencies = new Set();
  for (const candidate of names) {
    if (candidate !== module && new RegExp(`\\b${candidate}::`).test(source)) dependencies.add(candidate);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1]) && definitions.get(match[1]) !== module)
      throw new Error(`${match[1]} has duplicate connection-manager owners.`);
    definitions.set(match[1], module);
  }
  methods += [...source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)].length;
}
assertAcyclic(graph, "Rust connection manager");
for (const [symbol, owner] of Object.entries({
  ConnectionManager: "models", ManagedConnection: "models",
  ExternalDriverRuntimeSummary: "models", LiveConnectionCapabilitySnapshot: "models",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

const lifecycle = readSourceText(path.join(root, "src-tauri/src/core/manager/lifecycle.rs"));
const operations = readSourceText(path.join(root, "src-tauri/src/core/manager/operations.rs"));
for (const [source, method] of [[lifecycle, "replace_connection_with_tunnel_and_driver_id"], [lifecycle, "reconnect_external_driver_runtimes"], [operations, "query"], [operations, "begin_database_transaction"], [operations, "set_current_schema"]]) {
  if (!new RegExp(`^    pub(?:\\(super\\))? async fn ${method}\\b`, "m").test(source))
    throw new Error(`${method} must remain owned by its connection-manager module.`);
}
if (methods !== 106) throw new Error(`Expected 106 ConnectionManager methods; found ${methods}.`);
const observedDispatches = [
  "managed_table_definition", "managed_table_permissions",
  "query", "query_native_page", "fetch_native_query_page", "close_native_query_page", "cancel_query",
  "execute_parameterized", "create_database", "plan_schema_migration", "preflight_schema_migration",
  "apply_schema_migration", "verify_schema_migration", "query_parameterized", "query_database",
  "query_database_with_context", "query_database_parameterized", "execute_parameterized_batch",
  "execute_sqlite_rebuild_batch", "execute_database_parameterized_batch", "begin_transaction",
  "begin_database_transaction", "execute_parameterized_transaction", "commit_transaction", "rollback_transaction",
  "set_current_schema",
];
for (const method of observedDispatches) {
  const start = operations.search(new RegExp(`    pub async fn ${method}\\b`));
  const following = operations.indexOf("    pub async fn ", start + 1);
  const body = operations.slice(start, following < 0 ? operations.length : following);
  if (start < 0 || !body.includes("get_observed_driver(") || !/\.run(?:_transaction)?\(/u.test(body) || body.includes("self.get_driver(")) {
    throw new Error(`${method} must retain an observed driver dispatch and complete/drop guard.`);
  }
  if (["begin_transaction", "begin_database_transaction", "commit_transaction", "rollback_transaction"].includes(method) && !body.includes(".run_transaction(")) {
    throw new Error(`${method} must retain its transaction fence.`);
  }
}
if (!fs.existsSync(path.join(root, "src-tauri/src/core/manager/tests.rs")))
  throw new Error("Connection-manager tests must remain separate from production modules.");
console.log(`Rust connection-manager boundaries verified: ${modules.length} modules, ${methods} methods, one test module, acyclic imports.`);
