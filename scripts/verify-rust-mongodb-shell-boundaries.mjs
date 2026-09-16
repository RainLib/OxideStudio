import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const facade = fs.readFileSync(path.join(root, "src-tauri/src/drivers/mongodb_shell.rs"), "utf8");
const expected = ["arguments", "command", "source", "values"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)].map((match) => match[1]).filter((name) => name !== "tests");
if (modules.length !== expected.length || expected.some((name, index) => modules[index] !== name) || /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) || !facade.includes("pub(super) use command::{looks_like_shell_command, parse_commands};")) throw new Error("Mongo shell facade must remain module-only with its stable parser exports.");
const names = new Set(modules), graph = new Map(); let helpers = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/mongodb_shell/${module}.rs`, source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::drivers::mongodb_shell(?:::\w+)?::/.test(source)) throw new Error(`${file}: use owning modules directly.`);
  const deps = new Set(); for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) { if (!names.has(match[1])) throw new Error(`${file}: unknown dependency ${match[1]}.`); deps.add(match[1]); } graph.set(module, deps);
  helpers += [...source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Rust Mongo shell module");
for (const [symbol, owner] of Object.entries({ parse_command: "command", required_document_value: "arguments", parse_collection_prefix: "source", normalized_value: "values", transform_shell_constructors: "values" })) {
  if (!new RegExp(`\\b${symbol}\\b`).test(fs.readFileSync(path.join(root, `src-tauri/src/drivers/mongodb_shell/${owner}.rs`), "utf8"))) throw new Error(`${symbol} must belong to ${owner}.`);
}
const tests = fs.readFileSync(path.join(root, "src-tauri/src/drivers/mongodb_shell/tests.rs"), "utf8"); const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (helpers !== 26 || testCount !== 8) throw new Error(`Expected 32 parser helpers and 8 tests; found ${helpers} and ${testCount}.`);
console.log(`Rust Mongo shell boundaries verified: ${modules.length} modules, ${helpers} helpers, ${testCount} tests, acyclic imports.`);
