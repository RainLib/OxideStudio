import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/components/workspace/SchemaSnapshotDialog.tsx");
const controller = read("src/features/schema-diff/hooks/useSchemaSnapshotDialog.ts");
const view = read("src/features/schema-diff/ui/SchemaSnapshotDialogView.tsx");
const sidebar = read("src/features/schema-diff/ui/SchemaSnapshotDialogSidebar.tsx");
const details = read("src/features/schema-diff/ui/SchemaSnapshotDialogDetails.tsx");
const footer = read("src/features/schema-diff/ui/SchemaSnapshotDialogFooter.tsx");

for (const required of [
  "useSchemaSnapshotDialog",
  "SchemaSnapshotDialogView",
  "export function SchemaSnapshotDialog",
]) {
  if (!facade.includes(required)) throw new Error(`Schema snapshot facade must retain ${required}.`);
}
for (const required of [
  "export function useSchemaSnapshotDialog",
  "listSchemaSnapshots(identity)",
  "getLspDocuments({",
  "captureAndSaveSchemaSnapshot(identity)",
  "compareSnapshotToLive(",
  "createProjectDdlSnapshot(",
  "createSchemaDbmlSnapshot(",
  "createChartDbMetadataSnapshot(",
  "deleteSchemaSnapshot(snapshot)",
]) {
  if (!controller.includes(required)) throw new Error(`Schema snapshot controller must retain ${required}.`);
}
for (const [source, required] of [
  [view, "SchemaSnapshotDialogSidebar"],
  [view, "SchemaSnapshotDialogDetails"],
  [view, "SchemaSnapshotDialogFooter"],
  [sidebar, "export function SchemaSnapshotDialogSidebar"],
  [details, "export function SchemaSnapshotDialogDetails"],
  [details, "Project DDL source"],
  [footer, "export function SchemaSnapshotDialogFooter"],
]) {
  if (!source.includes(required)) throw new Error(`Schema snapshot UI composition must retain ${required}.`);
}
for (const source of [facade, view, sidebar, details, footer]) {
  if (source.includes('from "@/services/schemaSnapshotStore"') && source.includes("captureAndSaveSchemaSnapshot")) {
    throw new Error("Only the schema snapshot controller may invoke snapshot store actions.");
  }
}
console.log("Schema snapshot dialog boundaries verified: facade, state machine, and presentation owners are explicit.");
