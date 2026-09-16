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
const compositionPath = "src/features/workspace-tabs/state/rowMutationsSlice.ts";
const base = "src/features/workspace-tabs/state/row-mutations";
const composition = read(compositionPath);

for (const required of [
  'import { createCommitEditsAction } from "./row-mutations/commitEdits";',
  'import { createDeleteRowsAction } from "./row-mutations/deleteRows";',
  "...createCommitEditsAction(set, get),",
  "...createDeleteRowsAction(set, get),",
]) {
  if (!composition.includes(required)) {
    throw new Error(`Row mutations composition must retain ${required}.`);
  }
}
if (composition.includes("tableService") || composition.includes("useConnectionStore")) {
  throw new Error("Row mutations composition must not own transport or connection lookup.");
}

const ownership = {
  commitEdits: [
    'createCommitEditsAction: TabSlice<"commitEdits">',
    "tableDraftsAfterSuccessfulSave",
    "resultsAfterSubmittedEdits",
  ],
  deleteRows: [
    'createDeleteRowsAction: TabSlice<"deleteRows">',
    "pendingEditsAfterRowDeletion",
    "newRowPlacementsAfterRowDeletion",
  ],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Row mutations ${module} owner must retain ${symbol}.`);
    }
  }
}
if (read(`${base}/commitEdits.ts`).includes("deleteRows:")) {
  throw new Error("Commit action must not absorb row deletion lifecycle.");
}
if (read(`${base}/deleteRows.ts`).includes("commitEdits:")) {
  throw new Error("Delete action must not absorb insert/update lifecycle.");
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === compositionPath) {
      throw new Error(
        `${file} imports ${specifier}; row mutation owners must not depend on their composition slice.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Row mutation actions");
console.log(
  `Row mutation boundaries verified: ${files.length} dedicated insert/update and delete action modules, with an acyclic composition.`,
);
