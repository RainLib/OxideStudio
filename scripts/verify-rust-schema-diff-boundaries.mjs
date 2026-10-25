import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/core/schema_diff.rs";
const facade = readSourceText(path.join(root, entry));
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 17 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use snapshot::finalize_schema_snapshot;") ||
  !facade.includes("pub use compare::compare_schema_snapshots;") ||
  !facade.includes("pub(crate) use ddl::{add_constraint_sql, create_index_sql};")
) throw new Error(`${entry}: keep the schema diff entry to modules and stable exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let functions = 0;
for (const module of modules) {
  const file = `src-tauri/src/core/schema_diff/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::core::schema_diff::/.test(source))
    throw new Error(`${file}: import directly from the owning schema diff module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown schema diff dependency ${match[1]}.`);
    deps.add(match[1]);
  }
  graph.set(module, deps);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate schema diff owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) functions++;
  }
}
assertAcyclic(graph, "Rust schema diff");
for (const [symbol, owner] of Object.entries({
  SchemaSnapshot: "types", SchemaDiffPlan: "types",
  finalize_schema_snapshot: "snapshot", compare_schema_snapshots: "compare",
  compare_sqlite_schema_snapshots: "sqlite", compare_routines: "routines",
  compare_schema_objects: "objects", compare_relation: "relations",
  create_relation_sql: "ddl", create_index_sql: "ddl",
  mysql_character_clause: "ddl", mysql_character_changed: "ddl",
  finalize_change_plan: "plan_order", build_preflight_checks: "preflight",
  snapshot_fingerprint: "plan_model", render_migration_sql: "render",
  rewrite_postgres_schema_qualified_references: "postgres_refs",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);
if (functions !== 111) throw new Error(`Expected 111 schema diff functions, found ${functions}.`);
const tests = ["support", "metadata", "mysql_character", "relation", "views", "ddl", "sqlite", "planning"];
const testFolder = path.join(root, "src-tauri/src/core/schema_diff/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("Schema diff tests must remain split by scenario.");
console.log(`Rust schema diff boundaries verified: ${modules.length} modules, ${functions} functions, ${tests.length} test modules, acyclic imports.`);
