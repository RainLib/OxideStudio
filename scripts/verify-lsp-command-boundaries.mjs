import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/lsp.rs";
const facade = readSourceText(path.join(root, entry));
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((module) => module !== "tests");
const allowed = {
  session: new Set(["wire_types"]),
  wire_types: new Set(),
  completion_parse: new Set(["wire_types"]),
  completion_commands: new Set(["completion_parse", "session", "wire_types"]),
  position_commands: new Set(["session", "wire_types"]),
  document_commands: new Set(["session"]),
  configuration: new Set(["session"]),
  formatting: new Set(["session", "wire_types"]),
  generic: new Set(["session", "wire_types"]),
};
if (
  modules.length !== Object.keys(allowed).length ||
  modules.some((module) => !allowed[module]) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\b/m.test(facade) ||
  /^use\s+\w+::\*/m.test(facade)
) throw new Error(`${entry}: the LSP entry must only declare modules and public commands/types.`);
const graph = new Map();
const definitions = new Map();
const commands = new Set();
for (const module of modules) {
  const file = `src-tauri/src/commands/lsp/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|crate::commands::lsp::/.test(source))
    throw new Error(`${file}: import directly from an owning module.`);
  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!allowed[module].has(match[1]))
      throw new Error(`${file}: dependency on ${match[1]} crosses the LSP command boundary.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1]))
      throw new Error(`${match[1]} has duplicate owners.`);
    definitions.set(match[1], module);
  }
  for (const match of source.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)/g))
    commands.add(match[1]);
}
assertAcyclic(graph, "LSP command");
for (const [symbol, module] of Object.entries({
  LspState: "session", current_manager: "session",
  parse_bounded_completion_items: "completion_parse",
  validate_lsp_document_size: "document_commands",
  send_position_request: "position_commands",
})) if (definitions.get(symbol) !== module)
  throw new Error(`${symbol} must have exactly one owner in ${module}.`);
const lib = readSourceText(path.join(root, "src-tauri/src/lib.rs"));
const registered = new Set([...lib.matchAll(/commands::lsp::(\w+)/g)]
  .map((match) => match[1]).filter((name) => name !== "LspState"));
if (registered.size !== commands.size ||
    [...registered].some((name) => !commands.has(name)) ||
    [...commands].some((name) => !registered.has(name)))
  throw new Error("Registered LSP commands must match the implementation modules.");
console.log(`LSP command boundaries verified: ${modules.length} modules, ${commands.size} commands and an acyclic dependency graph.`);
