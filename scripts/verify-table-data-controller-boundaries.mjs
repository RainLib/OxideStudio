import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/components/workspace/TableDataView.tsx");
const controller = read("src/features/table-data/hooks/useTableDataController.ts");
const view = read("src/features/table-data/ui/TableDataViewContent.tsx");

for (const required of [
  "useTableDataController",
  "TableDataViewContent",
  "export function TableDataView",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Table data facade must retain ${required}.`);
  }
}
for (const required of [
  "export function useTableDataController",
  "useTableViewLifecycle({",
  "useTableInspection({",
  "useTableImportEvents({",
  "createTableNavigationActions({",
  "createTableExportActions({",
  "createTableImportActions({",
  "createTableStructureActions({",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Table data controller must retain ${required}.`);
  }
}
for (const required of [
  "export function TableDataViewContent",
  "TableDataDialogs",
  "TableViewToolbar",
  "TableStructurePanel",
  "DataGrid",
  "CreateConstraintDialog",
  "CreateIndexDialog",
]) {
  if (!view.includes(required)) {
    throw new Error(`Table data view must retain ${required}.`);
  }
}
for (const forbidden of ["useTabStore(", "useConnectionStore(", "useTaskStore("]) {
  if (view.includes(forbidden)) {
    throw new Error(`Table data view must not select global state through ${forbidden}.`);
  }
}
if (view.includes('components/workspace/TableDataView')) {
  throw new Error("Table data view must not import its compatibility facade.");
}

console.log("Table data controller boundaries verified: facade, lifecycle orchestration, and interactive view are explicit.");
