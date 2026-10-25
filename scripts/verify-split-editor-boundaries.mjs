import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readSourceText(path.join(root, relativePath));
const facadePath = "src/components/workspace/SplitEditor.tsx";
const base = "src/components/workspace/split-editor";
const facade = read(facadePath);

for (const required of [
  'import { EditorGroupPane } from "./split-editor/EditorGroupPane";',
  'import { ResizableSplitNode } from "./split-editor/ResizableSplitNode";',
  'import { useSplitEditorController } from "./split-editor/useSplitEditorController";',
  "const controller = useSplitEditorController();",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Split editor facade must retain ${required}.`);
  }
}

const ownership = {
  EditorGroupPane: ["export function EditorGroupPane", "<TabBar", "<QueryEditor"],
  ResizableSplitNode: [
    "export function ResizableSplitNode",
    "startResize",
    "document.addEventListener",
  ],
  useSplitEditorController: [
    "export function useSplitEditorController",
    "APP_EVENT_VIM_WINDOW_NAVIGATE",
    "vimNavigationHandlers",
  ],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.tsx`.replace("Controller.tsx", "Controller.ts"));
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Split editor ${module} owner must retain ${symbol}.`);
    }
  }
}

const controller = read(`${base}/useSplitEditorController.ts`);
for (const forbidden of ["QueryEditor", "TabBar", "ResizableSplitNode"]) {
  if (controller.includes(forbidden)) {
    throw new Error(`Split editor controller must not own ${forbidden} presentation.`);
  }
}
const resizableImports = readRuntimeImports(
  root,
  `${base}/ResizableSplitNode.tsx`,
);
if (
  resizableImports.some(
    ({ resolved }) => resolved === "src/store/useEditorGroupStore.ts",
  )
) {
  throw new Error("Resizable split node must remain independent of editor-group state.");
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; split-editor owners must not depend on the composition facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Split editor");
console.log(
  `Split editor boundaries verified: stable facade, ${graph.size} view/controller modules, and acyclic state-to-presentation ownership are explicit.`,
);
