import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/database_admin.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["events", "identity", "maintenance", "models", "read", "support", "write"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  !facade.includes("pub use models::*;")
) {
  throw new Error(`${entry}: retain the module-only database-administration facade and its stable model exports.`);
}

const names = new Set(modules);
const graph = new Map();
let helpers = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/database_admin/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const productionSource = source.replace(/\n#\[cfg\(test\)\][\s\S]*$/, "\n");
  if (
    /\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::database_admin(?:::\w+)?::/.test(productionSource)
  ) {
    throw new Error(`${file}: import directly from its owning database-administration module.`);
  }
  const dependencies = new Set();
  for (const match of productionSource.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) {
      throw new Error(`${file}: unknown database-administration dependency ${match[1]}.`);
    }
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  helpers += [...productionSource.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Rust database-administration module");

for (const [symbol, owner] of Object.entries({
  DatabaseAdminServerIdentity: "models",
  confirmed_admin_kind: "identity",
  list_database_admin_sessions: "read",
  create_database_admin_user: "write",
  preview_database_maintenance: "maintenance",
  list_database_admin_events: "events",
  database_admin_error_response: "support",
})) {
  const source = fs.readFileSync(
    path.join(root, `src-tauri/src/commands/database_admin/${owner}.rs`),
    "utf8",
  );
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`${symbol} must have one owner in ${owner}.`);
  }
}

const commandModules = {
  identity: ["get_database_admin_server_identity"],
  read: [
    "list_database_admin_sessions",
    "list_database_admin_metrics",
    "list_database_admin_lock_waits",
    "terminate_database_admin_session",
    "list_database_admin_users",
    "list_database_admin_role_memberships",
    "list_database_admin_table_privileges",
  ],
  write: [
    "create_database_admin_user",
    "update_database_admin_user_password",
    "set_database_admin_user_login",
    "delete_database_admin_user",
  ],
  maintenance: ["preview_database_maintenance", "execute_database_maintenance"],
  events: [
    "list_database_admin_events",
    "preview_database_admin_event_mutation",
    "execute_database_admin_event_mutation",
  ],
};
const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
for (const [module, commands] of Object.entries(commandModules)) {
  for (const command of commands) {
    if (!new RegExp(`\\bcommands::database_admin::${module}::${command},`).test(lib)) {
      throw new Error(`${command} must be registered from database_admin/${module}.rs.`);
    }
  }
}

const testFiles = ["tests", "events", "maintenance"];
const testCount = testFiles.reduce((count, file) => count + [
  ...fs.readFileSync(path.join(root, `src-tauri/src/commands/database_admin/${file}.rs`), "utf8")
    .matchAll(/^\s*#\[(?:tokio::)?test\]$/gm),
].length, 0);
if (helpers !== 75 || testCount !== 14) {
  throw new Error(`Expected 75 administration helpers and 14 tests; found ${helpers} and ${testCount}.`);
}
console.log(
  `Rust database-administration boundaries verified: ${modules.length} modules, ${helpers} helpers, 17 Tauri commands, ${testCount} tests, acyclic imports.`,
);
