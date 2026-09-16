import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/components/workspace/SchemaSidebar.tsx");
const controller = read("src/features/database-explorer/hooks/useSchemaSidebarController.ts");
const view = read("src/features/database-explorer/ui/SchemaSidebarView.tsx");

for (const required of [
  "useSchemaSidebarController",
  "SchemaSidebarView",
  "export function SchemaSidebar",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Schema sidebar facade must retain ${required}.`);
  }
}
for (const required of [
  "export function useSchemaSidebarController",
  "useExplorerWorkspaceData()",
  "useExplorerTreePreferences({",
  "createExplorerRefreshActions({",
  "createExplorerTableOpenActions({",
  "createExplorerCollectionQueries({",
  "createExplorerNamespaceActions({",
  "useExplorerObjectReveal({",
  "const presentationProps = {",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Schema sidebar controller must retain ${required}.`);
  }
}
for (const required of ["ExplorerSidebarPresentation", "const { presentationProps }"]) {
  if (!view.includes(required)) {
    throw new Error(`Schema sidebar view must retain ${required}.`);
  }
}
for (const forbidden of [
  "useExplorerWorkspaceData(",
  "useConnectionStore(",
  "useSchemaStore(",
  "useState(",
  "useEffect(",
  "createExplorer",
]) {
  if (view.includes(forbidden)) {
    throw new Error(`Schema sidebar view must not own ${forbidden}.`);
  }
}
if (view.includes('components/workspace/SchemaSidebar')) {
  throw new Error("Schema sidebar view must not import its Workspace facade.");
}
console.log("Schema sidebar controller boundaries verified: Workspace facade, Explorer lifecycle owner, and presentation are explicit.");
