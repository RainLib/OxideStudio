import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/components/workspace/SchemaStructuredDraftDialog.tsx");
const model = read("src/features/schema-diff/model/schemaStructuredDraftDialog.ts");
const controller = read("src/features/schema-diff/hooks/useSchemaStructuredDraftDialog.ts");
const view = read("src/features/schema-diff/ui/SchemaStructuredDraftDialogView.tsx");

for (const required of [
  "SchemaStructuredDraftDialogView",
  "SchemaStructuredDraftDialogProps",
  "export function SchemaStructuredDraftDialog",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Structured draft facade must retain ${required}.`);
  }
}
for (const required of [
  "export type SchemaStructuredDraftDialogProps",
  "export type SchemaStructuredDraftForeignKeySeed",
  "export type DraftPersistenceState",
]) {
  if (!model.includes(required)) {
    throw new Error(`Structured draft model must retain ${required}.`);
  }
}
for (const required of [
  "export function useSchemaStructuredDraftDialog",
  "loadSchemaDiagramDraft(snapshot)",
  "saveSchemaDiagramDraft(snapshot, relations)",
  "deleteSchemaDiagramDraft(snapshot)",
  "undoSchemaDiagramCanvas(canvasHistory)",
  "redoSchemaDiagramCanvas(canvasHistory)",
  "schemaService.compareSchemaSnapshots",
  "const addForeignKey",
  "const addCheck",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Structured draft controller must retain ${required}.`);
  }
}
for (const required of [
  "export function SchemaStructuredDraftDialogView",
  "useSchemaStructuredDraftDialog(props)",
  "Project autosave",
  "Review migration diff",
  "DraftSection",
  "MetadataRows",
]) {
  if (!view.includes(required)) {
    throw new Error(`Structured draft view must retain ${required}.`);
  }
}
for (const [source, name] of [
  [facade, "facade"],
  [view, "view"],
]) {
  for (const forbidden of [
    'from "@/services/schemaDiagramDraftStore"',
    'from "@/services/tauri/schema.service"',
    'from "@/features/schema-diff/model/schemaDiagramDraft"',
  ]) {
    if (source.includes(forbidden)) {
      throw new Error(`Structured draft ${name} must not call controller-only dependency ${forbidden}.`);
    }
  }
}
if (view.includes('components/workspace/SchemaStructuredDraftDialog')) {
  throw new Error("Structured draft view must not import its compatibility facade.");
}

console.log("Structured schema draft boundaries verified: facade, contract, lifecycle controller, and view are explicit.");
