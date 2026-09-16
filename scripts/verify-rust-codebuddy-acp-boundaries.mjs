import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "src-tauri/src/ai_cli/codebuddy";
const source = fs.readFileSync(path.join(root, `${base}.rs`), "utf8");

for (const required of [
  "mod acp;",
  "#[cfg(test)]\nmod tests;",
  "use acp::discover_catalog_via_acp;",
  "static CAPABILITY_CACHE",
  "async fn get_or_discover_capabilities_by_key",
  "pub async fn list_models_with_refresh",
  "pub async fn list_efforts_with_refresh",
  "pub async fn list_commands_with_refresh",
]) {
  if (!source.includes(required)) {
    throw new Error(`CodeBuddy discovery owner must retain ${required}.`);
  }
}

const acp = fs.readFileSync(path.join(root, `${base}/acp.rs`), "utf8");
for (const required of [
  "pub(super) async fn discover_catalog_via_acp",
  "pub(super) fn parse_available_commands",
  "async fn write_rpc",
  "async fn read_rpc_result_collecting_commands",
  "async fn collect_command_notification_with_grace",
]) {
  if (!acp.includes(required)) {
    throw new Error(`CodeBuddy ACP owner must retain ${required}.`);
  }
}

const tests = fs.readFileSync(path.join(root, `${base}/tests.rs`), "utf8");
for (const required of [
  "concurrent_capability_requests_share_one_discovery",
  "concurrent_effort_requests_share_one_model_scoped_discovery",
  "filters_codebuddy_commands_for_the_embedded_surface",
]) {
  if (!tests.includes(required)) {
    throw new Error(`CodeBuddy ACP regression owner must retain ${required}.`);
  }
}

console.log("Rust CodeBuddy ACP boundaries verified: public discovery/cache, ACP transport, and cache regressions are explicit.");
