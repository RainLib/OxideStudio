import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/elasticsearch.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = [
  "catalog", "collections", "connection", "console", "documents",
  "driver", "mappings", "models", "results", "runtime",
];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use models::ElasticsearchDriver;")
) throw new Error(`${entry}: retain a module-only facade and the public driver export.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let driverMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/elasticsearch/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+crate::drivers::elasticsearch::/.test(source))
    throw new Error(`${file}: import directly from its owning Elasticsearch module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown Elasticsearch dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate Elasticsearch owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  if (source.includes("impl ElasticsearchDriver") || source.includes("impl DatabaseDriver for ElasticsearchDriver")) {
    for (const match of source.matchAll(/^    (?:pub(?:\(super\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate Elasticsearch method owners.`);
      definitions.set(match[1], module);
      driverMethods++;
    }
  }
}

assertAcyclic(graph, "Rust Elasticsearch driver");
for (const [symbol, owner] of Object.entries({
  ElasticsearchDriver: "models", ElasticsearchRequest: "models",
  ElasticsearchDocumentCursor: "models", new: "runtime",
  execute_requests: "runtime", first_document_page: "documents",
  offset_document_page: "documents", server_version: "driver",
  get_document_page: "driver", list_collections_via_index_metadata: "catalog",
  normalize_elasticsearch_base_url: "connection",
  parse_elasticsearch_requests: "console",
  normalize_elasticsearch_response: "results",
  elasticsearch_indices_to_collections: "collections",
  elasticsearch_mapping_to_columns: "mappings",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 60 || driverMethods !== 32)
  throw new Error(`Expected 60 Elasticsearch helpers and 32 driver methods; found ${helpers} and ${driverMethods}.`);

const tests = ["support", "documents", "collections", "transport", "console", "results", "metadata"];
const testFolder = path.join(root, "src-tauri/src/drivers/elasticsearch/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("Elasticsearch tests must remain split by scenario.");

console.log(`Rust Elasticsearch driver boundaries verified: ${modules.length} modules, ${helpers} helpers, ${driverMethods} methods, seven test modules, acyclic imports.`);
