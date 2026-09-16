import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feature = "src/features/schema-diff";
const entry = "src/components/workspace/SchemaDiffView.tsx";
const files = [...listTypeScriptModules(root, feature), entry];
const importers = [
  {
    folder: `${feature}/model/dbml-import/`,
    facade: `${feature}/model/schemaDbmlImport.ts`,
  },
  {
    folder: `${feature}/model/project-ddl/`,
    facade: `${feature}/model/projectDdlSnapshot.ts`,
  },
];
const graph = new Map();
const isModel = (file) =>
  file?.startsWith(`${feature}/model/`) ||
  file?.startsWith(`${feature}/runtime/`);
const isHook = (file) => file?.startsWith(`${feature}/hooks/`);
const isUi = (file) =>
  file?.startsWith(`${feature}/ui/`) || file?.startsWith("src/components/");
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    const importer = importers.find(({ folder }) => file.startsWith(folder));
    if (importer) {
      if (resolved === importer.facade) {
        throw new Error(
          `${file} imports ${specifier}; import implementations must not depend on their compatibility facade.`,
        );
      }
      if (
        resolved?.startsWith("src/store/") ||
        resolved?.startsWith("src/services/") ||
        specifier === "react" ||
        specifier.startsWith("react/") ||
        specifier === "react-dom" ||
        specifier.startsWith("react-dom/")
      ) {
        throw new Error(
          `${file} imports ${specifier}; offline import models must remain independent of application state, service execution and React.`,
        );
      }
      if (
        file.endsWith("/lexical.ts") &&
        resolved?.startsWith(importer.folder)
      ) {
        throw new Error(
          `${file} imports ${specifier}; lexical scanning must not depend on semantic parsing or snapshot assembly.`,
        );
      }
    }
    if (file !== entry && resolved === entry) {
      throw new Error(
        `${file} imports ${specifier}; schema migration implementations must not depend on the workspace entry.`,
      );
    }
    if ((isModel(file) || isHook(file)) && isUi(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; schema migration models/runtime and lifecycle modules must not depend on UI components.`,
      );
    }
    if (isModel(file) && isHook(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; schema migration models/runtime must not depend on React lifecycle modules.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Schema migration");
console.log(
  `Schema migration boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
