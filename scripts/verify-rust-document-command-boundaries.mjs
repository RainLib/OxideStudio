import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/document.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["elasticsearch", "models", "mongodb", "support", "transfer"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  !facade.includes("pub use models::*;")
) {
  throw new Error(`${entry}: retain the module-only document-command facade and stable protocol model exports.`);
}

const names = new Set(modules);
const graph = new Map();
let helpers = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/document/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (
    /\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::document(?:::\w+)?::/.test(source)
  ) {
    throw new Error(`${file}: import directly from its owning document-command module.`);
  }
  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) {
      throw new Error(`${file}: unknown document-command dependency ${match[1]}.`);
    }
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  helpers += [...source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Rust document-command module");

for (const [symbol, owner] of Object.entries({
  MongoDocumentCloneRequest: "models",
  confirm_bundled_mongodb: "support",
  clone_plan_token: "mongodb",
  collection_transfer_plan_token: "transfer",
  elasticsearch_clear_plan_token: "elasticsearch",
})) {
  const source = fs.readFileSync(path.join(root, `src-tauri/src/commands/document/${owner}.rs`), "utf8");
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`${symbol} must have one owner in ${owner}.`);
  }
}

const commandModules = {
  mongodb: [
    "preview_mongodb_document_clone",
    "execute_mongodb_document_clone",
    "preview_mongodb_document_edit",
    "execute_mongodb_document_edit",
    "preview_mongodb_document_delete",
    "execute_mongodb_document_delete",
  ],
  transfer: ["preview_mongodb_collection_transfer", "execute_mongodb_collection_transfer"],
  elasticsearch: [
    "get_elasticsearch_index_metadata",
    "preview_elasticsearch_index_clear",
    "execute_elasticsearch_index_clear",
  ],
};
const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
for (const [module, commands] of Object.entries(commandModules)) {
  for (const command of commands) {
    if (!new RegExp(`\\bcommands::document::${module}::${command},`).test(lib)) {
      throw new Error(`${command} must be registered from document/${module}.rs.`);
    }
  }
}

const tests = fs.readFileSync(path.join(root, "src-tauri/src/commands/document/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (helpers !== 25 || testCount !== 9) {
  throw new Error(`Expected 25 document-command helpers and 9 tests; found ${helpers} and ${testCount}.`);
}
console.log(
  `Rust document-command boundaries verified: ${modules.length} modules, ${helpers} helpers, 11 Tauri commands, ${testCount} tests, acyclic imports.`,
);
