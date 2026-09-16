import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const feature = "src/features/database-explorer";
const entry = "src/components/workspace/SchemaSidebar.tsx";
const remoteEntry =
  "src/components/workspace/PostgresRemoteDatabaseContents.tsx";
const files = [...listTypeScriptModules(root, feature), entry, remoteEntry];
const isRemoteImplementation = (file) =>
  file.startsWith(`${feature}/`) &&
  /^(?:useRemoteCatalog|remoteCatalog|createRemoteRelationRenderer|createRemoteObjectRenderer)/i.test(
    path.basename(file),
  );
const graph = new Map();
const isModel = (file) => file?.startsWith(`${feature}/model/`);
const isHook = (file) => file?.startsWith(`${feature}/hooks/`);
const isUi = (file) =>
  file?.startsWith(`${feature}/ui/`) || file?.startsWith("src/components/");

for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (
      (file !== entry && resolved === entry) ||
      (isRemoteImplementation(file) && resolved === remoteEntry)
    ) {
      throw new Error(
        `${file} imports ${specifier}; Explorer implementations must not depend on the Explorer composition entry.`,
      );
    }
    if ((isModel(file) || isHook(file)) && isUi(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; Explorer models and lifecycle modules must not depend on UI components.`,
      );
    }
    if (isModel(file) && isHook(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; Explorer models must not depend on React lifecycle modules.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Database Explorer");
console.log(
  `Database Explorer boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
