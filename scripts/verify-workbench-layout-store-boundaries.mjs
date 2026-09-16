import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/store/useWorkbenchLayoutStore.ts");
const moduleRoot = "src/store/workbench-layout";
const contracts = read(`${moduleRoot}/contracts.ts`);
const runtime = read(`${moduleRoot}/settingsRuntime.ts`);
const math = read(`${moduleRoot}/layoutMath.ts`);
const visibility = read(`${moduleRoot}/visibilityActions.ts`);
const layout = read(`${moduleRoot}/layoutActions.ts`);
const session = read(`${moduleRoot}/sessionActions.ts`);
const factory = read(`${moduleRoot}/createWorkbenchLayoutStore.ts`);

if (!facade.includes("createWorkbenchLayoutStore")) {
  throw new Error("Workbench layout facade must retain the store factory.");
}
for (const source of [
  contracts,
  runtime,
  math,
  visibility,
  layout,
  session,
  factory,
]) {
  if (source.includes("useWorkbenchLayoutStore")) {
    throw new Error("Workbench layout owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("useSettingsStore") || math.includes("useSettingsStore")) {
  throw new Error("Workbench layout contracts and dimension math must stay state-runtime free.");
}
if (
  !runtime.includes("useSettingsStore") ||
  !runtime.includes("updateWorkbenchLayout")
) {
  throw new Error("Workbench settings runtime must own the shared settings bridge.");
}
if (
  !visibility.includes("toggleToolWindow") ||
  !visibility.includes("hideActiveToolWindow") ||
  visibility.includes("moveSideToolWindow")
) {
  throw new Error("Workbench visibility owner must not absorb docking actions.");
}
if (
  !layout.includes("resizeActiveToolWindow") ||
  !layout.includes("moveToolWindow") ||
  layout.includes("toggleAllToolWindows")
) {
  throw new Error("Workbench layout owner must retain only dimensions and docking.");
}
if (
  !session.includes("toggleAllToolWindows") ||
  !session.includes("jumpToLastToolWindow") ||
  session.includes("moveSideToolWindow")
) {
  throw new Error("Workbench session owner must retain hide-all restoration only.");
}
if (
  !factory.includes("createWorkbenchVisibilityActions") ||
  !factory.includes("createWorkbenchLayoutActions") ||
  !factory.includes("createWorkbenchSessionActions")
) {
  throw new Error("Workbench layout factory must compose every action owner.");
}

console.log(
  "Workbench layout store boundaries verified: contracts, settings bridge, visibility, dimensions, docking, and session restoration are explicit.",
);
