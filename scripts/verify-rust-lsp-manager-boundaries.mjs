import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manager = fs.readFileSync(path.join(root, "src-tauri/src/lsp/manager.rs"), "utf8");
const transport = fs.readFileSync(
  path.join(root, "src-tauri/src/lsp/manager/transport.rs"),
  "utf8",
);

for (const required of [
  "mod transport;",
  "pub struct LspServerManager",
  "spawn_lsp_transport(",
  "pub async fn start(&mut self)",
  "pub async fn send_request_with_token",
  "pub async fn cancel_request_token",
  "pub async fn send_notification",
]) {
  if (!manager.includes(required)) throw new Error(`LSP manager must retain ${required}.`);
}
for (const forbidden of [
  "read_lsp_header_line",
  "content_length_from_lsp_header",
  "lsp_server_request_response",
]) {
  if (manager.includes(forbidden)) {
    throw new Error(`LSP manager must delegate ${forbidden} to the transport owner.`);
  }
}
for (const required of [
  "pub(super) fn spawn_lsp_transport",
  "async fn read_lsp_header_line",
  "fn content_length_from_lsp_header",
  "fn lsp_server_request_response",
  "pub(super) enum LspOutgoingMessage",
  "pub(super) struct LspRequestTokens",
  "MAX_PENDING_LSP_RESPONSES",
  "$/cancelRequest",
  "mod tests",
]) {
  if (!transport.includes(required)) throw new Error(`LSP transport must retain ${required}.`);
}
console.log("Rust LSP manager boundaries verified: session supervision delegates framing and JSON-RPC transport.");
