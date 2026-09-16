import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/sqlite_ssh.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["driver", "metadata", "models", "platform", "response", "runtime", "transport"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  !facade.includes("pub use models::RemoteSqliteDriver;") ||
  !facade.includes("pub use platform::detect_remote_sqlite_platform;")
) throw new Error(`${entry}: retain the module-only remote SQLite facade and its stable connection exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/sqlite_ssh/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::drivers::sqlite_ssh(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning remote-SQLite module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown remote-SQLite dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate remote-SQLite owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  typeMethods += [...source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}

assertAcyclic(graph, "Rust remote SQLite module");
for (const [symbol, owner] of Object.entries({
  RemoteSqliteDriver: "models", SqliteWorkerClient: "models", WorkerTable: "models",
  detect_remote_sqlite_platform: "platform", worker_remote_path: "platform",
  validate_remote_absolute_path: "platform", prepare_and_start_worker: "transport",
  worker_body_result: "response", worker_query_result: "response", worker_table: "metadata",
  require_transaction: "runtime",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

const driver = fs.readFileSync(path.join(root, "src-tauri/src/drivers/sqlite_ssh/driver.rs"), "utf8");
for (const method of ["execute_sqlite_rebuild_batch", "cancel_query", "get_constraints"]) {
  if (!new RegExp(`^    async fn ${method}\\b`, "m").test(driver))
    throw new Error(`${method} must remain on the sole RemoteSqliteDriver trait adapter.`);
}

if (helpers !== 24 || typeMethods !== 48)
  throw new Error(`Expected 24 remote-SQLite helpers and 48 type methods; found ${helpers} and ${typeMethods}.`);

const tests = fs.readFileSync(path.join(root, "src-tauri/src/drivers/sqlite_ssh/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 3) throw new Error(`Expected 3 remote-SQLite regression scenarios; found ${testCount}.`);

console.log(`Rust remote SQLite boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${testCount} tests, acyclic imports.`);
