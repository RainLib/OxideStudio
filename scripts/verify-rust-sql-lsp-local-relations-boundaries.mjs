import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "vendor/sql-lsp/src/server/local_relations";
const facade = fs.readFileSync(path.join(root, `${base}.rs`), "utf8");
const syntax = fs.readFileSync(path.join(root, `${base}/syntax.rs`), "utf8");

for (const required of [
  "mod syntax;",
  "pub(super) use syntax::*;",
  "pub(super) fn augment_schema_with_local_relations",
  "pub(super) fn cte_tables_before_cursor",
  "pub(super) fn derived_tables_before_cursor",
]) {
  if (!facade.includes(required)) throw new Error(`Local-relation owner must retain ${required}.`);
}
for (const required of [
  "pub(in crate::server) fn read_local_identifier_after",
  "pub(in crate::server) fn local_relation_source_starts",
  "pub(in crate::server) fn matching_parenthesis_in_searchable",
  "pub(in crate::server) fn split_top_level_ranges_in_searchable",
]) {
  if (!syntax.includes(required)) throw new Error(`Local-relation syntax owner must retain ${required}.`);
}
console.log("Rust SQL LSP local-relation boundaries verified: shape discovery and reusable SQL-local syntax are explicit.");
