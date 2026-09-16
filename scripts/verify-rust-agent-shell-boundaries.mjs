import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/agent/shell.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
const allowed = {
  types: new Set(),
  syntax: new Set(["types"]),
  command_targets: new Set(["types", "syntax"]),
  policy_config: new Set(["types"]),
  builtin_policy: new Set(["types", "syntax", "command_targets", "policy_config"]),
  declarative_policy: new Set(["types", "syntax", "command_targets", "policy_config"]),
  policy_engine: new Set(["types", "syntax", "policy_config"]),
  execution: new Set(["types"]),
};
if (
  modules.length !== Object.keys(allowed).length ||
  modules.some((module) => !allowed[module]) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const|impl)\b/m.test(facade) ||
  /\buse\s+super::\*/.test(facade)
) throw new Error(`${entry}: the shell entry must only declare modules and public exports.`);
const graph = new Map();
const definitions = new Map();
for (const module of modules) {
  const file = `src-tauri/src/agent/shell/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|crate::agent::shell::/.test(source))
    throw new Error(`${file}: import from the owning shell module.`);
  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!allowed[module].has(match[1]))
      throw new Error(`${file}: dependency on ${match[1]} crosses the shell layer.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const|trait)\s+(\w+)/gm)) {
    if (definitions.has(match[1]) && definitions.get(match[1]) !== module)
      throw new Error(`${match[1]} has duplicate shell owners.`);
    definitions.set(match[1], module);
  }
}
assertAcyclic(graph, "Rust Agent Shell");
for (const [symbol, owner] of Object.entries({
  ShellSandboxMode: "types", CommandPolicyHook: "types",
  evaluate_shell_command_policy: "policy_engine",
  execute_shell_command: "execution", macos_workspace_profile: "execution",
  parse_shell_syntax: "syntax", destructive_target_scope: "command_targets",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have exactly one owner in ${owner}.`);
console.log(`Rust Agent Shell boundaries verified: ${modules.length} modules and an acyclic policy/execution graph.`);
