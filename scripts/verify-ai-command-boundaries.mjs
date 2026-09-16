import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/ai.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
const expected = new Set([
  "cancellation", "wire_types", "provider_settings", "provider_support",
  "chat_commands", "chat_transport", "inline_commands", "inline_transport",
  "cli_diagnostics", "cli_environment", "cli_cache", "cli_discovery", "cli_setup",
]);
if (
  modules.length !== expected.size ||
  modules.some((module) => !expected.has(module)) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\b/m.test(facade) ||
  /^use\s+\w+::\*/m.test(facade)
) {
  throw new Error(`${entry}: keep the facade limited to declared modules and explicit exports.`);
}
const definitions = new Map();
const commandDefinitions = new Map();
for (const module of modules) {
  const file = `src-tauri/src/commands/ai/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|crate::commands::ai::/.test(source)) {
    throw new Error(`${file}: use explicit imports and keep implementation out of the facade.`);
  }
  for (const match of source.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) {
      throw new Error(`${match[1]} is defined in both ${definitions.get(match[1])} and ${module}.`);
    }
    definitions.set(match[1], module);
  }
  for (const match of source.matchAll(/#\[tauri::command\]\s*pub async fn (\w+)/g)) {
    commandDefinitions.set(match[1], module);
  }
}
for (const [name, module] of Object.entries({
  AiCancellationState: "cancellation",
  load_cached_cli_capability: "cli_cache",
  send_chat_completion: "chat_transport",
  send_inline_completion: "inline_transport",
  cli_operation_error_code: "cli_diagnostics",
})) {
  if (definitions.get(name) !== module) throw new Error(`${name} must belong to ${module}.`);
}
const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
const registered = new Set([...lib.matchAll(/commands::ai::(\w+)/g)]
  .map((match) => match[1])
  .filter((name) => name !== "AiCancellationState"));
if (
  registered.size !== commandDefinitions.size ||
  [...registered].some((name) => !commandDefinitions.has(name)) ||
  [...commandDefinitions.keys()].some((name) => !registered.has(name))
) {
  throw new Error("AI Tauri command definitions must match the desktop handler registration.");
}
console.log(`AI command boundaries verified: ${modules.length} modules and ${registered.size} registered commands.`);
