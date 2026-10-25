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
const facadePath = "src/store/useEditorGroupStore.ts";
const base = "src/store/editor-groups";
const facade = read(facadePath);

for (const required of [
  'export { editorGroups } from "./editor-groups/layoutTree";',
  'export {\n  adjacentEditorGroup,\n  editorGroupInDirection,\n} from "./editor-groups/navigation";',
  "export const useEditorGroupStore = createEditorGroupStore();",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Editor group facade must retain ${required}.`);
  }
}

const ownership = {
  contracts: ["EditorGroupState", "EditorLayoutNode", "EditorSplitDirection"],
  layoutTree: [
    "createInitialEditorGroupLayout",
    "editorGroups",
    "updateEditorGroup",
    "removeEditorGroup",
  ],
  navigation: [
    "editorGroupRects",
    "editorGroupInDirection",
    "adjacentEditorGroup",
  ],
  nodeIds: ["createEditorGroupId", "createEditorSplitId"],
  actions: ["createEditorGroupActions", "split:", "closeGroup:"],
  createEditorGroupStore: ["createEditorGroupStore", "create<EditorGroupState>"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Editor group ${module} owner must retain ${symbol}.`);
    }
  }
}

for (const module of ["contracts", "layoutTree", "navigation", "nodeIds"]) {
  if (read(`${base}/${module}.ts`).includes("zustand")) {
    throw new Error(`Editor group ${module} must remain independent of Zustand runtime.`);
  }
}
if (read(`${base}/actions.ts`).includes('import { create } from "zustand";')) {
  throw new Error("Editor group actions may use Zustand types but must not create a store.");
}
if (read(`${base}/navigation.ts`).includes("nodeIds")) {
  throw new Error("Editor group navigation must remain independent of node identity runtime.");
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; editor-group owners must not depend on the compatibility facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Editor group store");
console.log(
  `Editor group store boundaries verified: stable facade, ${graph.size} layout-state modules, and acyclic tree/navigation ownership are explicit.`,
);
