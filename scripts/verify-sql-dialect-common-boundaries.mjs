import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "vendor/sql-lsp/src/dialects/common.rs";
const facade = readSourceText(path.join(root, entry));
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 9 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  modules.some((name) => !facade.includes(`pub(crate) use ${name}::*;`))
) throw new Error(`${entry}: keep the shared dialect entry to nine modules and stable exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let functions = 0;
for (const module of modules) {
  const file = `vendor/sql-lsp/src/dialects/common/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::dialects::common::/.test(source))
    throw new Error(`${file}: import directly from the owning dialect module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\bsuper::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown shared dialect dependency ${match[1]}.`);
    deps.add(match[1]);
  }
  graph.set(module, deps);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:fn|enum|struct)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate shared dialect owners.`);
    definitions.set(match[1], module);
    if (source.slice(match.index, match.index + match[0].length).includes("fn ")) functions++;
  }
}
assertAcyclic(graph, "SQL dialect common");
for (const [symbol, owner] of Object.entries({
  format_sql_pretty: "formatter", apply_formatter_layout: "formatter",
  cursor_prefix: "cursor", predicate_continuation_keywords: "cursor",
  create_table_item: "items", create_column_item: "items",
  add_column_value_items: "value_items", add_expression_value_items: "value_items", apply_value_completion_policy: "value_items", type_supports_truth_predicates: "value_items", type_supports_logical_continuation: "value_items",
  add_schema_columns: "schema", add_schema_using_columns: "schema",
  find_table_by_reference: "references", table_matches: "references", schema_hover: "hover",
  column_at_position: "scope_columns", apply_scoped_column_completion: "scope_columns",
  resolve_joined_sources: "joined", resolve_joined_sources_with_metadata: "joined", validate_join_profile: "joined",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);
if (functions !== 97) throw new Error(`Expected 97 shared dialect functions, found ${functions}.`);
if (!fs.existsSync(path.join(root, "vendor/sql-lsp/src/dialects/common/tests.rs")))
  throw new Error("Shared dialect tests must remain separate from production modules.");
console.log(`SQL dialect common boundaries verified: ${modules.length} modules, ${functions} functions, acyclic imports.`);
