import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "src-tauri/src/ai_cli/agent";
const facade = readSourceText(path.join(root, `${base}.rs`));

for (const required of [
  "mod command_config;",
  "mod errors;",
  "mod events;",
  "mod prepare;",
  "mod run;",
  "#[cfg(test)]\nmod tests;",
  "pub use errors::{classify_cli_error, CliAgentError};",
  "pub use events::{CliAgentEvent, CliAgentEventParser};",
  "pub use prepare::prepare_cli_run;",
  "pub use run::PreparedCliRun;",
]) {
  if (!facade.includes(required)) {
    throw new Error(`AI CLI agent facade must retain ${required}.`);
  }
}

const ownership = {
  command_config: ["pub(super) fn build_prompt", "pub(super) fn codex_args", "pub(super) fn codebuddy_args"],
  errors: ["pub struct CliAgentError", "pub fn classify_cli_error"],
  events: ["pub enum CliAgentEvent", "pub struct CliAgentEventParser", "parse_codex_app_server"],
  prepare: ["pub async fn prepare_cli_run", "BRIDGE_ENDPOINT_ENV", "isolated_working_directory"],
  run: ["pub struct PreparedCliRun", "pub(super) enum CliRunProtocol", "impl Drop for PreparedCliRun"],
  tests: ["maps_codex_app_server_stream_and_final_usage", "maps_codebuddy_tool_lifecycle_and_usage"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = readSourceText(path.join(root, `${base}/${module}.rs`));
  if (symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${module} must retain its AI CLI agent ownership.`);
  }
}

const prepare = readSourceText(path.join(root, `${base}/prepare.rs`));
if (!prepare.includes("command_config::{") || !prepare.includes("run::{CliRunProtocol, PreparedCliRun}")) {
  throw new Error("AI CLI preparation must depend directly on command configuration and the run owner.");
}

console.log("Rust AI CLI agent boundaries verified: facade, protocol events, configuration, preparation, run, and errors are explicit.");
