import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "vendor/sql-lsp/src/dialects/elasticsearch_dsl";
const facade = fs.readFileSync(path.join(root, `${base}.rs`), "utf8");
for (const required of [
  "mod completion;",
  "mod context;",
  "mod http;",
  "completion::complete(self, dsl, position, schema)",
  "http::extract_http_request_bodies(dsl)",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Elasticsearch DSL facade must retain ${required}.`);
  }
}

for (const [module, symbols] of Object.entries({
  completion: ["pub(super) fn complete", "ES_TOP_LEVEL_FIELDS", "add_schema_field_items"],
  context: ["pub(super) enum EsCompletionKind", "pub(super) fn elasticsearch_completion_context", "pub(super) fn elasticsearch_index_at_position"],
  http: ["pub(super) enum HttpRequestBodies", "pub(super) fn extract_http_request_bodies", "pub(super) fn offset_diagnostics"],
})) {
  const source = fs.readFileSync(path.join(root, `${base}/${module}.rs`), "utf8");
  if (/\buse\s+super::\*/.test(source) || symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${module} must retain direct Elasticsearch DSL ownership.`);
  }
}

const completion = fs.readFileSync(path.join(root, `${base}/completion.rs`), "utf8");
if (!completion.includes("use super::{context, ElasticsearchDslDialect};")) {
  throw new Error("Elasticsearch DSL completion must depend directly on the cursor-context owner.");
}
console.log("Rust SQL LSP Elasticsearch DSL boundaries verified: completion, context, and HTTP owners are explicit.");
