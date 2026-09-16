import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = "src/ai/tools";
const facades = new Set([
  `${directory}/index.ts`,
  `${directory}/coreTools.ts`,
  `${directory}/defaultRegistry.ts`,
]);
const graph = new Map();

for (const file of listTypeScriptModules(root, directory)) {
  const core = file.startsWith(`${directory}/core/`);
  const workspace = file.startsWith(`${directory}/workspace/`);
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if ((core || workspace) && facades.has(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; tool implementations must not depend on registry composition or public facades.`,
      );
    }
    if (
      (core && resolved?.startsWith(`${directory}/workspace/`)) ||
      (workspace && resolved?.startsWith(`${directory}/core/`))
    ) {
      throw new Error(
        `${file} imports ${specifier}; definitions and workspace adapters communicate through AiToolAdapters.`,
      );
    }
    if (resolved?.startsWith(`${directory}/`)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "AI tool");
console.log(
  `AI tool boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
