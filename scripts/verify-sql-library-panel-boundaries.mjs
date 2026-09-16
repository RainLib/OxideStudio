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
const facadePath = "src/components/workspace/SqlLibraryPanel.tsx";
const uiRoot = "src/features/saved-sql/ui";
const headerPath = `${uiRoot}/SqlLibraryPanelHeader.tsx`;
const treePath = `${uiRoot}/SqlLibraryTree.tsx`;
const dialogsPath = `${uiRoot}/SqlLibraryPanelDialogs.tsx`;
const typesPath = `${uiRoot}/sqlLibraryPanelTypes.ts`;
const facade = read(facadePath);
const header = read(headerPath);
const tree = read(treePath);
const dialogs = read(dialogsPath);
const types = read(typesPath);

for (const required of [
  'import { SqlLibraryPanelHeader } from "@/features/saved-sql/ui/SqlLibraryPanelHeader";',
  "<SqlLibraryPanelHeader",
  'import { SqlLibraryTree } from "@/features/saved-sql/ui/SqlLibraryTree";',
  "<SqlLibraryTree",
  'import { SqlLibraryPanelDialogs } from "@/features/saved-sql/ui/SqlLibraryPanelDialogs";',
  "<SqlLibraryPanelDialogs",
  "savedSqlService.importDirectory",
  "savedSqlService.exportDirectory",
  "readSavedSqlDrag",
]) {
  if (!facade.includes(required)) {
    throw new Error(`SQL Library facade must retain ${required}.`);
  }
}
for (const forbidden of [
  "DropdownMenuTrigger",
  "DialogContent",
  "function FolderRow",
  "function FileRow",
  "function RowMenu",
  'aria-label="Search SQL Library"',
]) {
  if (facade.includes(forbidden)) {
    throw new Error(`SQL Library facade must not retain presentation ${forbidden}.`);
  }
}
for (const required of [
  "export type SqlLibrarySortMode",
  "export type SqlLibraryEditDialog",
  "export type SqlLibraryDeleteTarget",
]) {
  if (!types.includes(required)) {
    throw new Error(`SQL Library UI contract must retain ${required}.`);
  }
}
for (const required of [
  "export function SqlLibraryPanelHeader",
  'aria-label="Search SQL Library"',
  "Import directory",
  "Export library",
]) {
  if (!header.includes(required)) {
    throw new Error(`SQL Library header owner must retain ${required}.`);
  }
}
for (const required of [
  "export function SqlLibraryTree",
  "function FolderRow",
  "function FileRow",
  "function RowMenu",
  "writeSavedSqlDrag",
  "role=\"tree\"",
]) {
  if (!tree.includes(required)) {
    throw new Error(`SQL Library tree owner must retain ${required}.`);
  }
}
for (const required of [
  "export function SqlLibraryPanelDialogs",
  "Rename SQL Library item",
  "permanently deleted",
  "onConfirmDelete",
]) {
  if (!dialogs.includes(required)) {
    throw new Error(`SQL Library dialog owner must retain ${required}.`);
  }
}
for (const [name, source] of Object.entries({ header, tree, dialogs, types })) {
  for (const forbidden of [
    "useSavedQueryStore",
    "useConnectionStore",
    "useTabStore",
    "savedSqlService",
    "SqlLibraryPanel.tsx",
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`SQL Library ${name} owner must not depend on facade state or transport ${forbidden}.`);
    }
  }
}

const files = listTypeScriptModules(root, uiRoot);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; SQL Library owners must not depend on their workspace facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "SQL Library UI");
console.log(
  `SQL Library panel boundaries verified: header, tree, dialogs, and ${graph.size} UI modules are acyclic.`,
);
