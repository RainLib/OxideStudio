import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = "src/features/query-editor";
const facade = `${directory}/index.ts`;
const entry = "src/components/workspace/QueryEditor.tsx";
const graph = new Map();

for (const file of [...listTypeScriptModules(root, directory), entry]) {
  const implementation = file !== facade && file !== entry;
  const model = file.startsWith(`${directory}/model/`);
  const hook = file.startsWith(`${directory}/hooks/`);
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (implementation && (resolved === facade || resolved === entry)) {
      throw new Error(
        `${file} imports ${specifier}; query editor implementations must depend on their owning modules, not the public entry.`,
      );
    }
    if (
      (model || hook) &&
      (resolved?.startsWith(`${directory}/ui/`) ||
        resolved?.startsWith("src/components/"))
    ) {
      throw new Error(
        `${file} imports ${specifier}; model and lifecycle modules must not depend on UI components.`,
      );
    }
    if (model && resolved?.startsWith(`${directory}/hooks/`)) {
      throw new Error(
        `${file} imports ${specifier}; query models must not depend on React lifecycle modules.`,
      );
    }
    if (resolved?.startsWith(`${directory}/`) || resolved === entry) {
      dependencies.add(resolved);
    }
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Query editor");
console.log(
  `Query editor boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
