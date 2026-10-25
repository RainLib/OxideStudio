import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/sqlite_backup_schedule.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["artifact_files", "artifacts", "autostart", "calendar", "commands", "control", "files", "installation", "installation_control", "installation_state", "leadership", "models", "plans", "process", "queue", "runner", "source", "state", "validation", "worker", "worker_exit"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)].map((match) => match[1]).filter((name) => !["tests", "worker_tests", "artifact_tests", "calendar_tests", "control_tests", "installation_tests"].includes(name));
if (modules.length !== expectedModules.length || expectedModules.some((name, index) => modules[index] !== name) || /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) || !facade.includes("pub use state::SqliteBackupScheduleState;"))
  throw new Error(`${entry}: retain the module-only SQLite backup schedule facade and stable schedule state export.`);

const names = new Set(modules);
const graph = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/sqlite_backup_schedule/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::sqlite_backup_schedule(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning backup-schedule module.`);
  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown backup-schedule dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  const production = source.split(/\n#\[cfg\(test\)\]\nmod tests\b/)[0];
  helpers += [...production.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
  typeMethods += [...production.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Rust SQLite backup schedule module");

for (const [symbol, owner] of Object.entries({
  SqliteBackupScheduleState: "state", ArtifactLedger: "artifacts", ArtifactFileIdentity: "artifact_files", preview_sqlite_backup_file_delete: "commands", save_schedule: "plans", enqueue_schedule: "queue", saved_source: "source", run_backup_worker_from_args: "worker", set_background_enabled: "autostart", canonical_destination: "validation", schedule_next_run: "calendar",
  compress_backup_file: "files", run_schedule: "runner", save_sqlite_backup_schedule: "commands",
})) {
  const source = readSourceText(path.join(root, `src-tauri/src/commands/sqlite_backup_schedule/${owner}.rs`));
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) throw new Error(`${symbol} must have one owner in ${owner}.`);
}
const commandNames = ["list_sqlite_backup_schedules", "get_sqlite_backup_worker_status", "set_sqlite_backup_background_enabled", "list_sqlite_backup_runs", "list_sqlite_backup_artifacts", "preview_sqlite_backup_file_delete", "save_sqlite_backup_schedule", "delete_sqlite_backup_schedule", "run_sqlite_backup_schedule", "run_due_sqlite_backup_schedules", "cancel_sqlite_backup_run", "delete_sqlite_backup_run"];
const lib = readSourceText(path.join(root, "src-tauri/src/lib.rs"));
for (const name of commandNames) {
  if (!new RegExp(`\\bcommands::sqlite_backup_schedule::commands::${name},`).test(lib)) throw new Error(`${name} must be registered from its defining command module.`);
}
if (helpers !== 105 || typeMethods !== 62) throw new Error(`Expected 105 backup-schedule helpers and 62 type methods; found ${helpers} and ${typeMethods}.`);
const tests = readSourceText(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/tests.rs"));
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 8) throw new Error(`Expected 8 backup-schedule regression scenarios; found ${testCount}.`);
const workerTests = readSourceText(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/worker_tests.rs"));
const workerTestCount = [...workerTests.matchAll(/^#\[(?:tokio::)?test(?:\([^\n]*\))?\]$/gm)].length;
if (workerTestCount !== 14) throw new Error(`Expected 14 native worker regressions; found ${workerTestCount}.`);
const calendarTests = readSourceText(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/calendar_tests.rs"));
const calendarTestCount = [...calendarTests.matchAll(/^#\[test\]$/gm)].length;
if (calendarTestCount !== 7) throw new Error(`Expected 7 calendar regressions; found ${calendarTestCount}.`);
const artifactTests = readSourceText(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/artifact_tests.rs"));
const artifactTestCount = [...artifactTests.matchAll(/^#\[(?:tokio::)?test(?:\([^\n]*\))?\]$/gm)].length;
if (artifactTestCount !== 13) throw new Error(`Expected 13 artifact ledger regressions; found ${artifactTestCount}.`);
const processTests = readSourceText(path.join(root, "src-tauri/tests/backup_worker.rs"));
const processTestCount = [...processTests.matchAll(/^#\[tokio::test\]$/gm)].length;
if (processTestCount !== 8 || !processTests.includes("subprocess fixture, invoked explicitly by the lifecycle test"))
  throw new Error("Retain the 3 default process regressions, 2 explicit cross-build checks, 3 installer scenarios and the desktop fixture.");
const controlTests = readSourceText(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/control_tests.rs"));
const controlTestCount = [...controlTests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (controlTestCount !== 7) throw new Error(`Expected 7 worker control regressions; found ${controlTestCount}.`);
const installationTests = readSourceText(path.join(root, "src-tauri/src/commands/sqlite_backup_schedule/installation_tests.rs"));
const installationTestCount = [...installationTests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (installationTestCount !== 8) throw new Error(`Expected 8 installer barrier regressions; found ${installationTestCount}.`);
console.log(`Rust SQLite backup schedule boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${commandNames.length} Tauri commands, ${testCount} schedule tests, ${workerTestCount} worker tests, ${calendarTestCount} calendar tests, ${artifactTestCount} artifact tests, ${controlTestCount} control tests, ${installationTestCount} installer tests, ${processTestCount} process scenarios, acyclic imports.`);
