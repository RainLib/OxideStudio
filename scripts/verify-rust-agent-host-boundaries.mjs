import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/agent/host.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 35 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const|impl)\b/m.test(facade) ||
  /\buse\s+super::\*/.test(facade) ||
  !facade.includes("pub use manager::AgentHostManager;")
) throw new Error(`${entry}: keep the host entry as a module facade and public manager export.`);
const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let innerMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/agent/host/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|crate::agent::host::/.test(source))
    throw new Error(`${file}: import directly from the owning helper/type module.`);
  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1]) || match[1].endsWith("_runtime"))
      throw new Error(`${file}: dependency on ${match[1]} crosses the Agent Host layer.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1]))
      throw new Error(`${match[1]} is defined in both ${definitions.get(match[1])} and ${module}.`);
    definitions.set(match[1], module);
  }
  if (module.endsWith("_runtime")) {
    const blocks = [...source.matchAll(/impl AgentHostInner \{/g)];
    if (blocks.length !== 1) throw new Error(`${file}: runtime methods must extend the one AgentHostInner state.`);
    innerMethods += [...source.matchAll(/^\s+pub\(super\) (?:async )?fn \w+/gm)].length;
  }
}
assertAcyclic(graph, "Rust Agent Host");
for (const [symbol, owner] of Object.entries({
  AgentHostManager: "manager", AgentHostInner: "session_state",
  RustHostTool: "tool_manifest", ActiveTurn: "turn_state",
  PendingApproval: "approval_types", ResolvedAgentConnection: "connection_types",
  HostCallError: "host_errors",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have exactly one owner in ${owner}.`);
if (innerMethods !== 80) throw new Error(`Expected 80 migrated AgentHostInner methods, found ${innerMethods}.`);
console.log(`Rust Agent Host boundaries verified: ${modules.length} modules, ${innerMethods} inner methods and an acyclic helper graph.`);
