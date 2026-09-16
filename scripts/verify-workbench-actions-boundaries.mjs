import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const facadePath = "src/lib/actions.ts";
const base = "src/lib/workbench-actions";
const facade = read(facadePath);

for (const required of [
  'export * from "@/lib/actionEvents";',
  'export type { WorkbenchAction, WorkbenchActionId } from "./workbench-actions/contracts";',
  'export { findWorkbenchAction, workbenchActions } from "./workbench-actions/registry";',
]) {
  if (!facade.includes(required)) {
    throw new Error(`Workbench actions facade must retain ${required}.`);
  }
}

const ownership = {
  contracts: ["WorkbenchActionId", "WorkbenchAction"],
  events: ["dispatchWorkbenchActionEvent"],
  global: ["createGlobalWorkbenchActions", "settings.openJson", "window.new"],
  query: ["createQueryLifecycleActions", "createQueryCommandActions"],
  editor: [
    "createEditorSplitActions",
    "createEditorLineAction",
    "createInlineCompletionActions",
  ],
  files: ["createFileSaveAction", "createOpenProjectFilesAction"],
  toolWindows: [
    "createDatabaseExplorerToggleAction",
    "createToolWindowFocusAndLayoutActions",
    "createToolWindowManagementActions",
  ],
  registry: ["workbenchActions", "findWorkbenchAction", "createGlobalWorkbenchActions"],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Workbench actions ${module} owner must retain ${symbol}.`);
    }
  }
}

for (const module of ["contracts", "events"]) {
  if (read(`${base}/${module}.ts`).includes("@/store/")) {
    throw new Error(`Workbench actions ${module} must remain store-independent.`);
  }
}
if (read(`${base}/registry.ts`).includes("@/store/")) {
  throw new Error("Workbench action registry must compose domain owners without store access.");
}
if (read(`${base}/editor.ts`).includes("useWorkbenchLayoutStore")) {
  throw new Error("Editor actions must not absorb workbench tool-window ownership.");
}
if (read(`${base}/toolWindows.ts`).includes("useTabStore")) {
  throw new Error("Tool-window actions must not absorb query-tab ownership.");
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; workbench-action owners must not depend on the compatibility facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Workbench actions");
console.log(
  `Workbench action boundaries verified: stable facade, ${graph.size} domain action modules, and acyclic registry ownership are explicit.`,
);
