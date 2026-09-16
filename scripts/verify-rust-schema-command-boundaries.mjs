import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/schema_diff.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 20 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|impl)\b/m.test(facade) ||
  ["capture", "compare", "execute", "journal"].some((name) => !facade.includes(`pub use ${name}::*;`)) ||
  !facade.includes("pub(crate) use capture::capture_schema_snapshot_inner;")
) throw new Error(`${entry}: retain the Tauri command and transfer exports in the facade.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let functions = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/schema_diff/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+crate::commands::schema_diff::/.test(source))
    throw new Error(`${file}: import directly from the owning schema command module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown schema command dependency ${match[1]}.`);
    deps.add(match[1]);
  }
  graph.set(module, deps);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate schema command owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) functions++;
  }
}
assertAcyclic(graph, "Rust schema command");
for (const [symbol, owner] of Object.entries({
  sql_string_literal: "capture_identity", schema_object_definition_key: "capture_identity",
  capture_native_view_definition: "view_capture",
  capture_postgres_routine_definitions: "pg_routine",
  capture_mysql_event_definitions: "mysql_catalog",
  capture_postgres_sequence_state: "pg_sequence",
  capture_postgres_view_dependencies: "pg_dependencies",
  ExternalSchemaMigrationSessionState: "session",
  SchemaMigrationJournalEntry: "journal_model",
  ActiveMigrationJournal: "execution_model",
  capture_schema_snapshot: "capture", semantic_schema_snapshot: "semantic",
  external_driver_plan: "external_plan", compare_schema_snapshots: "compare",
  execute_external_schema_migration: "external_execute",
  execute_schema_migration: "execute", list_schema_migration_journal: "journal",
  run_preflight_check: "preflight", build_rollback_artifact: "rollback",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);
if (functions !== 63) throw new Error(`Expected 63 migrated schema command functions, found ${functions}.`);
const tests = ["support", "catalog", "external", "preflight", "journal"];
const testFolder = path.join(root, "src-tauri/src/commands/schema_diff/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("Schema command tests must remain split by scenario.");
console.log(`Rust schema command boundaries verified: ${modules.length} modules, ${functions} functions, five test modules, acyclic imports.`);
