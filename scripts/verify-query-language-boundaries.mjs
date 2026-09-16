import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories = [
  "src/features/query-languages",
  "src/features/query-safety/model",
  "src/features/database-drivers/model",
];
const graph = new Map();

for (const file of directories.flatMap((directory) =>
  listTypeScriptModules(root, directory),
)) {
  const directory = directories.find((entry) => file.startsWith(`${entry}/`));
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (!resolved?.startsWith(`${directory}/`)) {
      throw new Error(
        `${file} imports ${specifier}; domain logic must not load compatibility facades, other runtime domains, UI, stores, or services.`,
      );
    }
    if (resolved.endsWith("/language.ts")) {
      throw new Error(
        `${file} imports ${resolved}; Monaco registration must depend on language logic, never the reverse.`,
      );
    }
    dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Query language");
console.log(
  `Query domain boundaries verified: ${graph.size} modules, no runtime import cycles or reverse adapter dependencies.`,
);
