import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/components/workspace/ProjectFilesSidebar.tsx");
const controller = read("src/features/projects/hooks/useProjectFilesSidebarController.ts");
const view = read("src/features/projects/ui/ProjectFilesSidebarView.tsx");
const node = read("src/features/projects/ui/ProjectFileNode.tsx");

for (const required of [
  "useProjectFilesSidebarController",
  "ProjectFilesSidebarView",
  "export function ProjectFilesSidebar",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Project files facade must retain ${required}.`);
  }
}
for (const required of [
  "export function useProjectFilesSidebarController",
  "selectProjectFileTree(fileState)",
  "compileProjectFileFilter(fileFilter)",
  "openProjectFileInEditor(node.relativePath)",
  "toggleDirectory(node.relativePath)",
  "showRenameDialog",
  "confirmDelete",
  "reloadConflictingFile",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Project files controller must retain ${required}.`);
  }
}
for (const required of [
  "export function ProjectFilesSidebarView",
  "ProjectFileNode",
  "File changed on disk",
  "Configure file name filter",
  "Delete {deleteTarget?.name}?",
]) {
  if (!view.includes(required)) {
    throw new Error(`Project files view must retain ${required}.`);
  }
}
for (const forbidden of ["useProjectFilesStore(", "useTabStore(", "useProjectStore("]) {
  if (view.includes(forbidden)) {
    throw new Error(`Project files view must not select global state through ${forbidden}.`);
  }
}
for (const required of [
  "export function ProjectFileNode",
  "supportsProjectFilePreview",
  "function isSqlFile",
  "DropdownMenu",
  "onRename",
  "onDelete",
  "<ProjectFileNode",
]) {
  if (!node.includes(required)) {
    throw new Error(`Project file node owner must retain ${required}.`);
  }
}
for (const source of [controller, view, node]) {
  if (source.includes('components/workspace/ProjectFilesSidebar')) {
    throw new Error("Project file implementations must not import their compatibility facade.");
  }
}

console.log("Project file tree boundaries verified: facade, state controller, view, and recursive node are explicit.");
