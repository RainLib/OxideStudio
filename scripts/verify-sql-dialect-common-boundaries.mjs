import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "vendor/sql-lsp/src/dialects/common.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 5 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  modules.some((name) => !facade.includes(`pub(crate) use ${name}::*;`))
) throw new Error(`${entry}: keep the shared dialect entry to five modules and stable exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let functions = 0;
for (const module of modules) {
  const file = `vendor/sql-lsp/src/dialects/common/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+crate::dialects::common::/.test(source))
    throw new Error(`${file}: import directly from the owning dialect module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
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
  add_schema_columns: "schema", add_schema_using_columns: "schema",
  find_table_by_reference: "references", table_matches: "references",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);
if (functions !== 73) throw new Error(`Expected 73 migrated shared dialect functions, found ${functions}.`);
if (!fs.existsSync(path.join(root, "vendor/sql-lsp/src/dialects/common/tests.rs")))
  throw new Error("Shared dialect tests must remain separate from production modules.");
console.log(`SQL dialect common boundaries verified: ${modules.length} modules, ${functions} functions, acyclic imports.`);
