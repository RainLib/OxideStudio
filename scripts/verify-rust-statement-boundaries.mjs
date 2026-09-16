import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/core/statement.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["filters", "read_only", "scanner", "soft_boundaries", "types"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use types::{QueryExecutionMode, SqlStatementSpan, StatementKind, StatementScanDialect};")
) throw new Error(`${entry}: retain the module-only statement facade and public types.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/core/statement/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+crate::core::statement::/.test(source))
    throw new Error(`${file}: import directly from its owning statement module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown statement dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate statement owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  if (source.includes("impl StatementKind")) {
    for (const match of source.matchAll(/^    (?:pub(?:\(super\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate statement method owners.`);
      definitions.set(match[1], module);
      typeMethods++;
    }
  }
}

assertAcyclic(graph, "Rust statement module");
for (const [symbol, owner] of Object.entries({
  StatementKind: "types", as_str: "types", skip_quoted_region: "scanner",
  split_sql_statement_spans: "scanner", execution_statement_kind: "scanner",
  split_sql_statement_spans_with_soft_boundaries: "soft_boundaries",
  split_sql_statements: "soft_boundaries", validate_read_only_sql: "read_only",
  validate_sql_filter_expression: "filters",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 47 || typeMethods !== 1)
  throw new Error(`Expected 47 statement helpers and 1 type method; found ${helpers} and ${typeMethods}.`);

const tests = fs.readFileSync(path.join(root, "src-tauri/src/core/statement/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 23) throw new Error(`Expected 23 statement regression scenarios; found ${testCount}.`);

console.log(`Rust statement boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type method, ${testCount} tests, acyclic imports.`);
