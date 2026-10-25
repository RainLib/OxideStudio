import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";
import "./verify-sql-grammar-source.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "vendor/sql-lsp/src/parser/sql.rs";
const facade = readSourceText(path.join(root, entry));
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 35 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const|impl)\b/m.test(facade) ||
  /\buse\s+super::\*/.test(facade) ||
  !facade.replace(/\s+/gu," ").includes("pub use types::{ AstNode, CompletionContext, JoinExpr, JoinKind, ParseResult, RelationAlias, RelationScope, SqlParser, };")
) throw new Error(`${entry}: keep the parser facade to modules and stable public types.`);
const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let parserMethods = 0;
for (const module of modules) {
  const file = `vendor/sql-lsp/src/parser/sql/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|crate::parser::sql::/.test(source))
    throw new Error(`${file}: import directly from the owning parser module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1]) ||
        !(["types", "soft_statements"].includes(match[1]) &&
          (match[1] !== "soft_statements" || module === "statement_boundaries")) &&
          !(match[1] === "normalization" && ["core", "syntax_tree"].includes(module)) &&
          !(["fulltext", "apply", "bracket_identifiers"].includes(match[1]) && module === "normalization") &&
          !(match[1] === "query_scopes" && module === "correlation") &&
          !(match[1] === "identifier_paths" && module === "identifiers"))
      throw new Error(`${file}: dependency on ${match[1]} crosses the SQL parser layer.`);
    deps.add(match[1]);
  }
  graph.set(module, deps);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate parser owners.`);
    definitions.set(match[1], module);
  }
  for (const match of source.matchAll(/^\s{4}(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate parser method owners.`);
    definitions.set(match[1], module);
    parserMethods++;
  }
}
assertAcyclic(graph, "SQL parser");
for (const [symbol, owner] of Object.entries({
  SqlParser: "types", CompletionContext: "types",
  JoinExpr: "types", JoinKind: "types", joined_source_scope: "join_model",
  lateral_source_scope: "join_model", query_source_visible: "query_scopes",
  lateral_views: "lateral_views", LateralView: "lateral_views", query_from_range_at_position: "join_model",
  qualify_query_range: "qualify", qualify_projection_range: "qualify",
  parse_completion_tree: "syntax_tree",
  parse_incremental: "core", completion_context_from_text: "completion_context",
  mask_sql_noise: "masking", innermost_query_scope_start: "query_scopes",
  normalize_for_parser: "normalization", source_node_text: "normalization",
  match_against_expressions: "match_against", parse_syntax_tree: "syntax_tree",
  adapt_languages: "fulltext", completion_context_source: "query_scopes",
  statement_boundary: "statement_boundaries", extract_cte_names: "cte_scope",
  relation_aliases_at_position: "aliases", extract_row_sources_at_position: "row_sources",
  validate: "tsql_modules", table_name_matches_with_namespace: "identifiers",
  read_table_variable_reference: "relation_scanner",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have exactly one owner in ${owner}.`);
if (parserMethods !== 246) throw new Error(`Expected 246 parser methods, found ${parserMethods}.`);
const testFolder = path.join(root, "vendor/sql-lsp/src/parser/sql/tests");
const scenarios = ["syntax", "completion", "fallback_dml", "unicode", "relations", "search"];
if (scenarios.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("SQL parser test scenarios must remain split by domain.");
console.log(`SQL parser boundaries verified: ${modules.length} modules, ${parserMethods} methods and ${scenarios.length} test scenarios.`);
