import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/commands/project_git.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["github", "models", "operations", "patch", "repository", "runtime", "validation"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("ProjectGitRepository") ||
  !facade.includes("GitHubRepository")
) throw new Error(`${entry}: retain the module-only Project Git facade and stable result exports.`);

for (const commandModule of ["github", "operations", "patch", "repository"]) {
  if (!facade.includes(`pub mod ${commandModule};`))
    throw new Error(`${entry}: Tauri command module ${commandModule} must remain public for macro registration.`);
}

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/commands/project_git/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::commands::project_git(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning Project Git module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown Project Git dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate Project Git owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate Project Git method owners.`);
    definitions.set(match[1], module);
    typeMethods++;
  }
}

assertAcyclic(graph, "Rust Project Git module");
for (const [symbol, owner] of Object.entries({
  ProjectGitRepository: "models", GitHubRepository: "models", run_bounded: "runtime",
  validate_remote_url: "validation", repository_snapshot: "repository",
  get_project_git_repository: "repository", stage_project_git_paths: "operations",
  update_project_git_index_patch: "patch", authenticate_github_cli: "github",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 48 || typeMethods !== 0)
  throw new Error(`Expected 48 Project Git helpers and 0 type methods; found ${helpers} and ${typeMethods}.`);

const lib = fs.readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
const commands = {
  repository: ["get_project_git_repository", "get_project_git_commit_files"],
  operations: ["init_project_git_repository", "stage_project_git_paths", "unstage_project_git_paths", "commit_project_git_changes", "create_project_git_branch", "checkout_project_git_branch", "set_project_git_remote", "fetch_project_git_repository", "pull_project_git_repository", "push_project_git_repository"],
  patch: ["get_project_git_patch", "get_project_git_file_versions", "apply_project_git_patch", "update_project_git_index_patch"],
  github: ["get_github_cli_status", "authenticate_github_cli", "search_github_repositories", "clone_git_repository"],
};
for (const [module, functions] of Object.entries(commands)) for (const command of functions) {
  const nestedPath = `commands::project_git::${module}::${command}`;
  if (!lib.includes(nestedPath))
    throw new Error(`src-tauri/src/lib.rs: register ${nestedPath} where its Tauri command macro is defined.`);
}

const tests = fs.readFileSync(path.join(root, "src-tauri/src/commands/project_git/tests.rs"), "utf8");
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 7) throw new Error(`Expected 7 Project Git regression scenarios; found ${testCount}.`);

console.log(`Rust Project Git boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${testCount} tests, acyclic imports.`);
