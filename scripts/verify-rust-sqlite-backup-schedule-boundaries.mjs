import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/sqlite_backup_schedule.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["calendar", "commands", "files", "models", "runner", "state", "validation"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)].map((match) => match[1]).filter((name) => name !== "tests");
if (modules.length !== expectedModules.length || expectedModules.some((name, index) => modules[index] !== name) || /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) || !facade.includes("pub use state::SqliteBackupScheduleState;"))
  throw new Error(`${entry}: retain the module-only SQLite backup schedule facade and stable schedule state export.`);

const names = new Set(modules);
const graph = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/sqlite_backup_schedule/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::sqlite_backup_schedule(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning backup-schedule module.`);
  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown backup-schedule dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  helpers += [...source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
  typeMethods += [...source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Rust SQLite backup schedule module");

for (const [symbol, owner] of Object.entries({
  SqliteBackupScheduleState: "state", canonical_destination: "validation", schedule_next_run: "calendar",
  compress_backup_file: "files", run_schedule: "runner", save_sqlite_backup_schedule: "commands",
})) {
  const source = fs.readFileSync(path.join(root, `src-tauri/src/commands/sqlite_backup_schedule/${owner}.rs`), "utf8");
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) throw new Error(`${symbol} must have one owner in ${owner}.`);
}
const commandNames = ["list_sqlite_backup_schedules", "list_sqlite_backup_runs", "save_sqlite_backup_schedule", "delete_sqlite_backup_schedule", "run_sqlite_backup_schedule", "run_due_sqlite_backup_schedules", "cancel_sqlite_backup_run", "delete_sqlite_backup_run"];
const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
for (const name of commandNames) {
  if (!new RegExp(`\\bcommands::sqlite_backup_schedule::commands::${name},`).test(lib)) throw new Error(`${name} must be registered from its defining command module.`);
}
if (helpers !== 36 || typeMethods !== 7) throw new Error(`Expected 36 backup-schedule helpers and 7 type methods; found ${helpers} and ${typeMethods}.`);
const tests = fs.readFileSync(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 8) throw new Error(`Expected 8 backup-schedule regression scenarios; found ${testCount}.`);
console.log(`Rust SQLite backup schedule boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${commandNames.length} Tauri commands, ${testCount} tests, acyclic imports.`);
