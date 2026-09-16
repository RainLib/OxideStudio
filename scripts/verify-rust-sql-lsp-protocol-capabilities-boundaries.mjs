import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "vendor/sql-lsp/src/server/protocol";
const protocol = fs.readFileSync(path.join(root, `${base}.rs`), "utf8");
const capabilities = fs.readFileSync(path.join(root, `${base}/capabilities.rs`), "utf8");

for (const required of [
  "mod capabilities;",
  "impl LanguageServer for SqlLspServer",
  "Ok(capabilities::initialize_result(",
  "&self.completion_documentation_resolve_supported,",
  "async fn initialized",
  "async fn shutdown",
]) {
  if (!protocol.includes(required)) {
    throw new Error(`SQL LSP protocol facade must retain ${required}.`);
  }
}
for (const required of [
  "pub(super) fn initialize_result",
  "client_supports_completion_documentation_resolve(&params)",
  "TextDocumentSyncKind::INCREMENTAL",
  "completion_provider: Some(CompletionOptions",
  "signature_help_provider: Some(SignatureHelpOptions",
  "semantic_tokens_provider: Some(",
  "legend: semantic_tokens_legend()",
  "diagnostic_provider: Some(DiagnosticServerCapabilities::Options",
]) {
  if (!capabilities.includes(required)) {
    throw new Error(`SQL LSP capability owner must retain ${required}.`);
  }
}
console.log("Rust SQL LSP protocol boundaries verified: initialization capability negotiation has one explicit owner.");
