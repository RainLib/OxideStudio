import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/query.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["completion", "execution", "imports", "models", "read_only", "state"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use state::{ParserState, QueryCancellationState};") ||
  !facade.includes("pub(crate) use read_only::execute_query_with_cancellation;")
) throw new Error(`${entry}: retain the module-only query facade and stable state exports.`);

for (const commandModule of ["completion", "execution", "imports", "read_only"]) {
  if (!facade.includes(`pub mod ${commandModule};`))
    throw new Error(`${entry}: Tauri command module ${commandModule} must remain public for macro registration.`);
}

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/query/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::query(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning query module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown query dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate query owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate query method owners.`);
    definitions.set(match[1], module);
    typeMethods++;
  }
}

assertAcyclic(graph, "Rust query command module");
for (const [symbol, owner] of Object.entries({
  QueryCancellationState: "state", sql_statement_at_cursor: "state",
  validate_sql_syntax_text: "state", extracted_database_error: "models",
  execute_query_with_cancellation: "read_only", execute_query: "execution",
  import_sql_script: "imports", get_sql_completion: "completion",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 38 || typeMethods !== 3)
  throw new Error(`Expected 38 query helpers and 3 type methods; found ${helpers} and ${typeMethods}.`);

const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
const commands = {
  execution: ["execute_query", "execute_native_query_page", "fetch_native_query_page", "close_native_query_page", "resolve_sql_statement_at_cursor", "validate_sql_syntax"],
  imports: ["build_dml_change_preview_sql", "preview_sql_script_import", "import_sql_script", "import_elasticsearch_console_file", "export_elasticsearch_console_file"],
  read_only: ["execute_read_only_query", "explain_query"],
  completion: ["cancel_query", "get_sql_completion"],
};
for (const [module, functions] of Object.entries(commands)) for (const command of functions) {
  const nestedPath = `commands::query::${module}::${command}`;
  if (!lib.includes(nestedPath))
    throw new Error(`src-tauri/src/lib.rs: register ${nestedPath} where its Tauri command macro is defined.`);
}

const tests = fs.readFileSync(path.join(root, "src-tauri/src/commands/query/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 18) throw new Error(`Expected 18 query command regression scenarios; found ${testCount}.`);

console.log(`Rust query command boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${testCount} tests, acyclic imports.`);
