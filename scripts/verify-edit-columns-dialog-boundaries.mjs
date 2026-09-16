import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/components/workspace/EditColumnsDialog.tsx");
const controller = read("src/features/table-data/hooks/useEditColumnsDialogController.ts");
const view = read("src/features/table-data/ui/EditColumnsDialogView.tsx");
const model = read("src/features/table-data/model/editColumnsDialog.ts");

for (const required of [
  "useEditColumnsDialogController",
  "EditColumnsDialogView",
  "export function EditColumnsDialog",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Edit columns facade must retain ${required}.`);
  }
}

for (const required of [
  "export function useEditColumnsDialogController",
  "loadTableMetadata({",
  "getDatabaseCapabilities(",
  "tableService.addTableColumn(",
  "tableService.alterTableColumn(",
  "tableService.renameTableColumn(",
  "tableService.dropTableColumn(",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Edit columns controller must retain ${required}.`);
  }
}

for (const required of [
  "createDefaultColumnDraft",
  "parseColumnDataType",
  "createAlterColumnDraft",
  "formatColumnFlags",
]) {
  if (!model.includes(`export function ${required}`)) {
    throw new Error(`Edit columns model must retain ${required}.`);
  }
}

for (const forbidden of [
  "useState(",
  "useEffect(",
  "databaseService",
  "tableService",
  "useConnectionStore(",
  "useSchemaStore(",
  "useTabStore(",
]) {
  if (view.includes(forbidden)) {
    throw new Error(`Edit columns view must not own ${forbidden}.`);
  }
}

if (view.includes('components/workspace/EditColumnsDialog')) {
  throw new Error("Edit columns view must not import its compatibility facade.");
}

console.log("Edit columns dialog boundaries verified: facade, dialect model, lifecycle controller, and presentation are explicit.");
