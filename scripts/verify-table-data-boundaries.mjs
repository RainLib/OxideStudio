import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const features = new Map([
  ["src/features/table-data", "src/components/workspace/TableDataView.tsx"],
  [
    "src/features/table-transfer",
    "src/components/workspace/TableDataTransferDialog.tsx",
  ],
]);
const files = [...features].flatMap(([directory, entry]) => [
  ...listTypeScriptModules(root, directory),
  entry,
]);
const graph = new Map();
const isModel = (file) =>
  [...features.keys()].some((directory) =>
    file?.startsWith(`${directory}/model/`),
  );
const isHook = (file) =>
  [...features.keys()].some((directory) =>
    file?.startsWith(`${directory}/hooks/`),
  ) || file === "src/features/table-data/useTableInspection.ts";
const isUi = (file) =>
  file?.startsWith("src/components/") ||
  [...features.keys()].some((directory) =>
    file?.startsWith(`${directory}/ui/`),
  );

for (const file of files) {
  const owner = [...features].find(([directory]) =>
    file.startsWith(`${directory}/`),
  );
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (owner && resolved === owner[1]) {
      throw new Error(
        `${file} imports ${specifier}; table feature implementations must not depend on their own composition entry.`,
      );
    }
    if ((isModel(file) || isHook(file)) && isUi(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; table models and lifecycle modules must not depend on UI components.`,
      );
    }
    if (isModel(file) && isHook(resolved)) {
      throw new Error(
        `${file} imports ${specifier}; table models must not depend on React lifecycle modules.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Table data");
console.log(
  `Table data boundaries verified: ${graph.size} modules, no internal runtime cycles or reverse composition dependencies.`,
);
