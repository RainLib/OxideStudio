import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "vendor/sql-lsp/src/dialects/mysql";
const facade = fs.readFileSync(path.join(root, `${base}.rs`), "utf8");
for (const required of [
  "mod completion;",
  "mod helpers;",
  "mod hover;",
  "completion::completion(self, sql, position, schema)",
  "hover::hover(self, sql, position, schema)",
]) {
  if (!facade.includes(required)) {
    throw new Error(`MySQL dialect facade must retain ${required}.`);
  }
}
if (facade.includes("CompletionContext")) {
  throw new Error("MySQL dialect facade must not own completion-context dispatch.");
}
for (const [name, symbols] of Object.entries({
  completion: [
    "pub(super) fn completion",
    "CompletionContext::FromClause",
    "CompletionContext::TableColumn",
    "common::apply_column_aliases",
  ],
  helpers: ["MysqlDialect", "create_keyword_item", "add_schema_columns"],
  hover: ["pub(super) fn hover", "MysqlDialect::find_table_by_reference"],
})) {
  const source = fs.readFileSync(path.join(root, `${base}/${name}.rs`), "utf8");
  if (/\buse\s+super::\*/.test(source) || symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${name} must retain direct MySQL dialect ownership.`);
  }
}
console.log("Rust SQL LSP MySQL boundaries verified: completion, helper, and hover owners are explicit.");
