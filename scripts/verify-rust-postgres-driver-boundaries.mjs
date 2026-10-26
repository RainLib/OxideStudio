import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/postgres.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["driver", "metadata", "models", "parameters", "queries", "values"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use models::PostgresDriver;")
) throw new Error(`${entry}: retain a module-only facade and the public driver export.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let driverMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/postgres/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::drivers::postgres::/.test(source))
    throw new Error(`${file}: import directly from its owning PostgreSQL module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown PostgreSQL dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate PostgreSQL owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  if (source.includes("impl PostgresDriver") || source.includes("impl DatabaseDriver for PostgresDriver")) {
    for (const match of source.matchAll(/^    (?:pub(?:\(super\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate PostgreSQL method owners.`);
      definitions.set(match[1], module);
      driverMethods++;
    }
  }
}

assertAcyclic(graph, "Rust PostgreSQL driver");
for (const [symbol, owner] of Object.entries({
  PostgresDriver: "models", PostgresTransactionSession: "models",
  postgres_search_path_with_selected_schema: "models", new: "metadata",
  metadata_connect_options: "metadata", functions_on_pool: "metadata",
  process_rows: "queries", cancel_tracked_queries_on_pool: "queries",
  parse_postgres_function_parameters: "parameters", statement_scan_dialect: "driver",
  begin_database_transaction: "driver", get_database_schema_objects: "driver",
  decode_pg_value: "values", bind_pg_parameter: "values",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 37 || driverMethods !== 78)
  throw new Error(`Expected 37 PostgreSQL helpers and 78 driver methods; found ${helpers} and ${driverMethods}.`);

const tests = ["core", "tracking", "statements", "live"];
const testFolder = path.join(root, "src-tauri/src/drivers/postgres/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("PostgreSQL tests must remain split by scenario.");

console.log(`Rust PostgreSQL driver boundaries verified: ${modules.length} modules, ${helpers} helpers, ${driverMethods} methods, four test modules, acyclic imports.`);
