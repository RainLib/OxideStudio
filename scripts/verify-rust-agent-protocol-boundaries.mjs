import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "src-tauri/src/agent/protocol";
const facade = fs.readFileSync(path.join(root, `${base}.rs`), "utf8");

for (const required of [
  "mod artifacts;",
  "mod graph;",
  "mod invocation;",
  "mod provider;",
  "mod rpc;",
  "#[cfg(test)]\nmod tests;",
  "mod turns;",
  "pub use artifacts::*;",
  "pub use graph::*;",
  "pub use invocation::*;",
  "pub use provider::*;",
  "pub use rpc::*;",
  "pub use turns::*;",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Agent protocol facade must retain ${required}.`);
  }
}

if (/^use\s/m.test(facade)) {
  throw new Error("Agent protocol facade must not retain domain implementation imports.");
}

const ownership = {
  provider: ["pub struct RequestMetadata", "pub struct AgentTurnRequest"],
  turns: ["pub struct AgentTurnJournal", "pub struct AgentHostStatus"],
  invocation: ["pub struct ModelCompleteRequest", "pub struct ToolPreflightRequest"],
  graph: ["pub struct GraphTypedBlob", "pub struct GraphCheckpointPutWritesRequest"],
  artifacts: ["pub struct ArtifactReadRequest", "pub struct AgentArtifactExportResult"],
  rpc: ["pub fn rpc_request", "pub async fn read_json_frame", "pub async fn write_json_frame"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = fs.readFileSync(path.join(root, `${base}/${module}.rs`), "utf8");
  if (/\buse\s+super::\*/.test(source) || symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${module} must retain direct Agent protocol ownership.`);
  }
}

for (const module of ["turns", "invocation", "graph", "artifacts"]) {
  const source = fs.readFileSync(path.join(root, `${base}/${module}.rs`), "utf8");
  if (!/use\s+super(?:::\{[^}]*\bRequestMetadata\b[^}]*\}|::RequestMetadata);/.test(source)) {
    throw new Error(`${module} must import provider metadata through the stable protocol facade.`);
  }
}

console.log("Rust Agent protocol boundaries verified: stable facade and six protocol owners are explicit.");
