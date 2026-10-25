import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/mongodb.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["commands", "documents", "driver", "models", "read_only", "results", "runtime"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use models::MongoDbDriver;") ||
  !facade.includes("pub(crate) use runtime::mongodb_url_uses_oidc;")
) throw new Error(`${entry}: retain a module-only facade and the public MongoDB entrypoints.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let driverMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/mongodb/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::drivers::mongodb::/.test(source))
    throw new Error(`${file}: import directly from its owning MongoDB module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (match[1] === "super") continue;
    if (!names.has(match[1])) throw new Error(`${file}: unknown MongoDB dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate MongoDB owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  for (const block of source.matchAll(/^impl (?:(?:DatabaseDriver for )?MongoDbDriver|MongoCommandInput) \{([\s\S]*?)^\}/gm)) {
    for (const match of block[1].matchAll(/^    (?:pub(?:\(super\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate MongoDB method owners.`);
      definitions.set(match[1], module);
      driverMethods++;
    }
  }
}

assertAcyclic(graph, "Rust MongoDB driver");
for (const [symbol, owner] of Object.entries({
  MongoDbDriver: "models", MongoCommandInput: "models", MongoUpdateInput: "models",
  mongodb_url_uses_oidc: "runtime", new: "runtime", new_agent_owned: "runtime", execute_command: "runtime",
  read_only_documents: "read_only", DocumentPageBuilder: "read_only", read_documents_read_only: "driver",
  parse_mongodb_commands: "commands", build_find_command: "commands",
  prepare_mongodb_document_clone: "documents", exact_source_filter: "documents",
  documents_result: "results", infer_mongodb_columns: "results",
  validate_mongodb_collection_name: "results", connect: "driver",
  write_document_transfer_batch: "driver", get_collections: "driver",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 35 || driverMethods !== 33)
  throw new Error(`Expected 35 MongoDB helpers and 33 driver methods; found ${helpers} and ${driverMethods}.`);

const tests = readSourceText(path.join(root, "src-tauri/src/drivers/mongodb/tests.rs"));
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 31) throw new Error(`Expected 31 MongoDB regression scenarios; found ${testCount}.`);

console.log(`Rust MongoDB driver boundaries verified: ${modules.length} modules, ${helpers} helpers, ${driverMethods} methods, ${testCount} tests, acyclic imports.`);
