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
const facadePath = "src/components/workspace/CreateTableTab.tsx";
const featureRoot = "src/features/table-creation";
const sourcePath = `${featureRoot}/model/importSource.ts`;
const typesPath = `${featureRoot}/model/types.ts`;
const importPath = `${featureRoot}/ui/CreateTableImportSource.tsx`;
const columnsPath = `${featureRoot}/ui/CreateTableColumnEditor.tsx`;
const previewPath = `${featureRoot}/ui/CreateTableSqlPreview.tsx`;
const facade = read(facadePath);
const source = read(sourcePath);
const types = read(typesPath);
const importView = read(importPath);
const columns = read(columnsPath);
const preview = read(previewPath);

for (const required of [
  'import { CreateTableImportSource } from "@/features/table-creation/ui/CreateTableImportSource";',
  "<CreateTableImportSource",
  'import { CreateTableColumnEditor } from "@/features/table-creation/ui/CreateTableColumnEditor";',
  "<CreateTableColumnEditor",
  'import { CreateTableSqlPreview } from "@/features/table-creation/ui/CreateTableSqlPreview";',
  "<CreateTableSqlPreview",
  "tableService.createTable",
  "tableService.importTableData",
  "loadTables(connectionId, schemaName, true)",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Create table facade must retain ${required}.`);
  }
}
for (const forbidden of [
  "SelectTrigger",
  "function importFormatForPath",
  "function importTableNameSuggestion",
  "SQL preview",
  "Drag to reorder",
]) {
  if (facade.includes(forbidden)) {
    throw new Error(`Create table facade must not retain owned presentation ${forbidden}.`);
  }
}
for (const required of ["export function importFormatForPath", "export function importTableNameSuggestion"]) {
  if (!source.includes(required)) {
    throw new Error(`Table import source model must retain ${required}.`);
  }
}
for (const required of [
  "export interface CreateTableColumn",
  "export interface TableImportSource",
  "export interface CreateTableColumnDragState",
]) {
  if (!types.includes(required)) {
    throw new Error(`Table creation contracts must retain ${required}.`);
  }
}
for (const required of [
  "export function CreateTableImportSource",
  "Choose file",
  "Replace file",
  "Use manual columns only",
]) {
  if (!importView.includes(required)) {
    throw new Error(`Table import view must retain ${required}.`);
  }
}
for (const required of [
  "export function CreateTableColumnEditor",
  "Drag to reorder",
  "supportsAutoIncrementForDataType",
  "Add Column",
]) {
  if (!columns.includes(required)) {
    throw new Error(`Table column editor must retain ${required}.`);
  }
}
for (const required of [
  "export function CreateTableSqlPreview",
  "SQL preview",
  "Preview unavailable",
]) {
  if (!preview.includes(required)) {
    throw new Error(`Table SQL preview must retain ${required}.`);
  }
}
for (const [name, view] of Object.entries({ importView, columns, preview })) {
  for (const forbidden of [
    "useConnectionStore",
    "useSchemaStore",
    "useTabStore",
    "tableService",
    "CreateTableTab.tsx",
  ]) {
    if (view.includes(forbidden)) {
      throw new Error(`Create table ${name} view must not depend on facade state or lifecycle ${forbidden}.`);
    }
  }
}

const files = listTypeScriptModules(root, featureRoot);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; table creation owners must not depend on the workspace facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Table creation");
console.log(
  `Create table tab boundaries verified: import source, column editor, SQL preview, and ${graph.size} feature modules are acyclic.`,
);
