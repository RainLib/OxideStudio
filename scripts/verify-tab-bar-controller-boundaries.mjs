import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/components/workspace/TabBar.tsx");
const model = read("src/features/workspace-tabs/model/tabBar.ts");
const controller = read("src/features/workspace-tabs/hooks/useTabBarController.ts");
const view = read("src/features/workspace-tabs/ui/TabBarView.tsx");
for (const required of ["TabBarView", "TabBarProps", "export function TabBar"]) {
  if (!facade.includes(required)) throw new Error(`Tab bar facade must retain ${required}.`);
}
for (const required of ["export interface TabBarProps", "export type TabDragState"]) {
  if (!model.includes(required)) throw new Error(`Tab bar model must retain ${required}.`);
}
for (const required of [
  "export function useTabBarController",
  "organizeEditorTabs(",
  "handleDragOver",
  "finishDrag",
  "createQueryConsole",
  "ResizeObserver",
  "scrollIntoView",
]) {
  if (!controller.includes(required)) throw new Error(`Tab bar controller must retain ${required}.`);
}
for (const required of ["export function TabBarView", "DropdownMenu", "TabIcon", "Split Editor", "Compare Data With"]) {
  if (!view.includes(required)) throw new Error(`Tab bar view must retain ${required}.`);
}
for (const forbidden of ["useTabStore(", "useConnectionStore(", "useSettingsStore("]) {
  if (view.includes(forbidden)) throw new Error(`Tab bar view must not select global state through ${forbidden}.`);
}
if (view.includes('components/workspace/TabBar')) throw new Error("Tab bar view must not import its compatibility facade.");
console.log("Tab bar controller boundaries verified: facade, tab lifecycle controller, and interactive view are explicit.");
