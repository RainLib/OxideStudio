import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/sqlite.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["backup", "driver", "models", "runtime", "values"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  !facade.includes("pub use models::SqliteDriver;") ||
  !facade.includes("pub(super) use backup::{replace_backup_file, sync_file, temporary_backup_path};") ||
  !facade.includes("pub(super) use runtime::validate_sqlite_rebuild_statements;")
) throw new Error(`${entry}: retain the module-only SQLite facade and stable SQLite SSH helper exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/sqlite/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::drivers::sqlite(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning SQLite-driver module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown SQLite-driver dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate SQLite-driver owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate SQLite-driver method owners.`);
    definitions.set(match[1], module);
    typeMethods++;
  }
}

assertAcyclic(graph, "Rust SQLite driver module");
for (const [symbol, owner] of Object.entries({
  SqliteDriver: "models", sqlite_column_ownership: "models", pool: "runtime",
  query_script: "runtime", validate_sqlite_rebuild_statements: "runtime",
  copy_sqlite_database: "backup", validate_restore_source: "backup",
  bind_sqlite_parameter: "values", sqlite_value: "values", connect: "driver",
  execute_sqlite_rebuild_batch: "driver", get_schema_objects: "driver",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 22 || typeMethods !== 32)
  throw new Error(`Expected 22 SQLite-driver helpers and 32 type methods; found ${helpers} and ${typeMethods}.`);

const tests = fs.readFileSync(path.join(root, "src-tauri/src/drivers/sqlite/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 16) throw new Error(`Expected 16 SQLite-driver regression scenarios; found ${testCount}.`);

console.log(`Rust SQLite driver boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${testCount} tests, acyclic imports.`);
