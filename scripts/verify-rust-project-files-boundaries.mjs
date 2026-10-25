import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/project_files.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["agent", "commands", "completion", "filesystem", "git", "models"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|impl)\b/m.test(facade) ||
  !facade.includes("pub(crate) use agent::{") ||
  !facade.includes("pub use commands::*;") ||
  !facade.includes("pub use git::*;") ||
  !facade.includes("ProjectFileAppliedChange")
) throw new Error(`${entry}: retain a module-only facade and the stable command, agent, and model exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/project_files/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::commands::project_files::/.test(source))
    throw new Error(`${file}: import directly from its owner instead of the compatibility facade.`);

  const dependencies = new Set();
  for (const candidate of names) {
    if (candidate !== module && new RegExp(`\\b${candidate}::`).test(source)) dependencies.add(candidate);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|type)\s+(\w+)/gm)) {
    const symbol = match[1];
    if (definitions.has(symbol) && definitions.get(symbol) !== module)
      throw new Error(`${symbol} has duplicate project-files owners.`);
    definitions.set(symbol, module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
}

assertAcyclic(graph, "Rust project-files commands");
for (const [symbol, owner] of Object.entries({
  ProjectRoot: "models", ProjectEntry: "models", ProjectFileAppliedChange: "models",
  ProjectGitDiffScope: "models", validate_relative_path: "filesystem",
  remove_tree_without_following_links: "filesystem", completion_index: "completion",
  project_lsp_documents: "completion", project_root: "agent",
  file_query_source: "agent",
  agent_apply_project_file_change: "agent", set_project_root: "commands",
  get_project_lsp_documents: "commands", write_project_file: "commands",
  run_git_bounded: "git", get_project_git_changes: "git", get_project_git_file_diff: "git",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

const filesystem = readSourceText(path.join(root, "src-tauri/src/commands/project_files/filesystem.rs"));
const rootMethods = [...filesystem.matchAll(/^    pub\(super\) fn (\w+)/gm)].map((match) => match[1]);
const expectedRootMethods = [
  "new", "list_entries", "read_file", "read_file_preview", "create_file", "prepare_file_change",
  "create_directory", "write_file", "rename_entry", "delete_entry", "delete_file_if_revision",
  "assert_revision", "resolve_existing", "resolve_new_target", "validate_new_target_without_mutation",
  "ensure_inside_root", "describe_entry",
];
if (
  rootMethods.length !== expectedRootMethods.length ||
  expectedRootMethods.some((name, index) => rootMethods[index] !== name)
) throw new Error("ProjectRoot methods must remain owned by the filesystem module.");

if (helpers !== 59) throw new Error(`Expected 59 project-file helpers; found ${helpers}.`);
const tests = ["filesystem", "git", "support"];
const testFolder = path.join(root, "src-tauri/src/commands/project_files/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("Project-file tests must remain grouped by filesystem, Git, and platform support.");

console.log(`Rust project-files boundaries verified: ${modules.length} modules, ${helpers} helpers, ${rootMethods.length} ProjectRoot methods, three test modules, acyclic imports.`);
