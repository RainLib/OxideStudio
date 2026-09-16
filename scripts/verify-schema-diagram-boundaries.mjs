import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feature = "src/features/schema-diagram";
const entry = "src/components/workspace/SchemaDiagramView.tsx";
const libraries = fs
  .readdirSync(path.join(root, "src/lib"))
  .filter(
    (name) =>
      /^schemaDiagram.*\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name),
  )
  .map((name) => `src/lib/${name}`);
const files = [
  ...listTypeScriptModules(root, feature),
  ...libraries,
  "src/services/schemaDiagramCanvasStore.ts",
  "src/services/schemaDiagramDraftStore.ts",
  entry,
];
const graph = new Map();
const isModel = (file) =>
  file?.startsWith(`${feature}/model/`) || libraries.includes(file);
const isHook = (file) => file?.startsWith(`${feature}/hooks/`);
const isUi = (file) =>
  file?.startsWith(`${feature}/ui/`) || file?.startsWith("src/components/");
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (file !== entry && resolved === entry) {
      throw new Error(
        `${file} imports ${specifier}; diagram implementations must not depend on the workspace entry.`,
      );
    }
    if ((isModel(file) || isHook(file)) && isUi(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; diagram models and lifecycle modules must not depend on UI components.`,
      );
    }
    if (isModel(file) && isHook(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; diagram models must not depend on React lifecycle modules.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Schema diagram");
console.log(
  `Schema diagram boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
