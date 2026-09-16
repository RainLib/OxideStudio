import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/components/workspace/QueryEditor.tsx");
const controller = read("src/features/query-editor/hooks/useQueryEditorController.ts");
const workspaceState = read(
  "src/features/query-editor/hooks/useQueryEditorWorkspaceState.ts",
);
for (const required of ["useQueryEditorController", "QueryEditorCommandBar", "QueryEditorSurface", "QueryEditorStatusBar"]) {
  if (!facade.includes(required)) throw new Error(`Query editor facade must retain ${required}.`);
}
for (const required of ["export function useQueryEditorController", "useQueryEditorWorkspaceState(", "useLspClient(", "useLspDocumentLifecycle(", "useQueryExecutionController(", "useQuerySqlCompletion(", "useEditorLanguageServices(", "useElasticsearchAnalysis("]) {
  if (!controller.includes(required)) throw new Error(`Query editor controller must retain ${required}.`);
}
for (const forbidden of ["QueryEditorCommandBar", "QueryEditorSurface", "QueryEditorStatusBar"]) {
  if (controller.includes(forbidden)) throw new Error(`Query editor controller must not render ${forbidden}.`);
}
for (const required of [
  "export function useQueryEditorWorkspaceState",
  "useTabStore",
  "useConnectionStore",
  "useSchemaStore",
  "useSavedQueryStore",
  "useSettingsStore",
  "useShallow",
]) {
  if (!workspaceState.includes(required)) {
    throw new Error(`Query editor workspace state owner must retain ${required}.`);
  }
}
for (const forbidden of [
  "useTabStore",
  "useConnectionStore",
  "useSchemaStore",
  "useSavedQueryStore",
  "useSettingsStore",
]) {
  if (controller.includes(forbidden)) {
    throw new Error(`Query editor controller must inject ${forbidden} through workspace state.`);
  }
}
console.log("Query editor controller boundaries verified: workspace selection, lifecycle orchestration, and UI composition are separate.");
