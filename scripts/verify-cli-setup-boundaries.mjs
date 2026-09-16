import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/ai_cli/setup.rs";
const folder = "src-tauri/src/ai_cli/setup";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
if (
  /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|static|const)\b/m.test(
    facade,
  )
) {
  throw new Error(
    `${entry}: the compatibility entry must only declare modules and exports.`,
  );
}
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
const allowed = {
  installation: new Set(["packages", "paths"]),
  packages: new Set(["paths"]),
  paths: new Set(),
  authentication_state: new Set(),
  authentication: new Set([
    "authentication_state",
    "codebuddy_authentication",
    "codex_authentication",
  ]),
  codebuddy_authentication: new Set([
    "authentication_state",
    "authentication_process",
    "authentication_protocol",
    "authentication_verification",
  ]),
  codex_authentication: new Set([
    "authentication_state",
    "authentication_process",
    "authentication_protocol",
    "authentication_verification",
  ]),
  authentication_process: new Set(),
  authentication_protocol: new Set(),
  authentication_verification: new Set(["authentication_state"]),
};
const graph = new Map();
for (const module of modules) {
  const file = `${folder}/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (!allowed[module])
    throw new Error(
      `${file}: declare the new module's responsibility and dependency direction.`,
    );
  if (/\buse\s+super::\*|crate::ai_cli::setup::/.test(source))
    throw new Error(
      `${file}: use explicit owning modules, not the setup facade or parent wildcard.`,
    );
  const dependencies = new Set();
  for (const match of source.matchAll(/\bsuper::(\w+)::/g)) {
    if (!modules.includes(match[1]) || !allowed[module].has(match[1]))
      throw new Error(
        `${file}: dependency on ${match[1]} crosses the CLI setup layer boundary.`,
      );
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
}
assertAcyclic(graph, "CLI setup");
for (const [symbol, owner] of [
  ["AUTHENTICATION_SESSIONS", "authentication_state"],
  ["INSTALLATION_SESSIONS", "installation"],
]) {
  const definitions = modules.filter((module) =>
    new RegExp(`\\bstatic\\s+${symbol}\\b`).test(
      fs.readFileSync(path.join(root, folder, `${module}.rs`), "utf8"),
    ),
  );
  if (definitions.length !== 1 || definitions[0] !== owner)
    throw new Error(`${symbol} must have exactly one owner in ${owner}.`);
}
console.log(
  `CLI setup boundaries verified: ${modules.length} implementation modules, explicit dependencies and unique session owners.`,
);
