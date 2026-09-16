import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/agent/store.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["crypto", "graph", "models", "persistence", "records", "runtime"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  !facade.includes("pub use models::AgentStore;") ||
  !facade.includes("pub(crate) use models::{StoredGraphCheckpoint, StoredGraphWrite};")
) throw new Error(`${entry}: retain the module-only Agent Store facade and its stable Agent Host exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/agent/store/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::agent::store(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning Agent Store module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown Agent Store dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate Agent Store owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  typeMethods += [...source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}

assertAcyclic(graph, "Rust Agent Store module");
for (const [symbol, owner] of Object.entries({
  AgentStore: "models", StoredGraphCheckpoint: "models", StoredGraphWrite: "models",
  RecordKey: "models", validate_graph_scope: "models", resolve_persistent_key: "crypto",
  encrypt_json: "crypto", init_schema: "persistence", decode_graph_write: "persistence",
  save_thread: "records", clear_project: "records", save_graph_checkpoint: "graph",
  delete_graph_thread: "graph", backend: "runtime",
})) if (definitions.get(symbol) !== owner && !["save_thread", "clear_project", "save_graph_checkpoint", "delete_graph_thread", "backend"].includes(symbol))
  throw new Error(`${symbol} must have one owner in ${owner}.`);

const methodOwners = {
  save_thread: "records", clear_project: "records", save_graph_checkpoint: "graph",
  delete_graph_thread: "graph", backend: "runtime",
};
for (const [symbol, owner] of Object.entries(methodOwners)) {
  const source = fs.readFileSync(path.join(root, `src-tauri/src/agent/store/${owner}.rs`), "utf8");
  if (!new RegExp(`^    (?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${symbol}\\b`, "m").test(source))
    throw new Error(`${symbol} must have one owner in ${owner}.`);
}

if (helpers !== 23 || typeMethods !== 36)
  throw new Error(`Expected 23 Agent Store helpers and 36 type methods; found ${helpers} and ${typeMethods}.`);

const tests = fs.readFileSync(path.join(root, "src-tauri/src/agent/store/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 9) throw new Error(`Expected 9 Agent Store regression scenarios; found ${testCount}.`);

console.log(`Rust Agent Store boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${testCount} tests, acyclic imports.`);
