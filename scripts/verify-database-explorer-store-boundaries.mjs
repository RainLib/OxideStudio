import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/store/useDatabaseExplorerStore.ts");
const moduleRoot = "src/store/database-explorer";

for (const required of [
  "createDatabaseExplorerStore",
  "useExplorerExpansionState",
  "useExplorerExpansionSetState",
  "resetDatabaseExplorerStoreForTests",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Database Explorer store facade must retain ${required}.`);
  }
}

const contracts = read(`${moduleRoot}/contracts.ts`);
const state = read(`${moduleRoot}/state.ts`);
const preferences = read(`${moduleRoot}/preferenceActions.ts`);
const visibility = read(`${moduleRoot}/visibilityActions.ts`);
const groups = read(`${moduleRoot}/groupActions.ts`);
const lifecycle = read(`${moduleRoot}/lifecycleActions.ts`);
const factory = read(`${moduleRoot}/createDatabaseExplorerStore.ts`);

for (const source of [
  contracts,
  state,
  preferences,
  visibility,
  groups,
  lifecycle,
  factory,
]) {
  if (source.includes("useDatabaseExplorerStore")) {
    throw new Error("Database Explorer store owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("zustand/middleware") || state.includes("zustand")) {
  throw new Error("Database Explorer contracts and state helpers must remain store-runtime free.");
}
if (
  !preferences.includes("updateExpanded") ||
  preferences.includes("hideExplorerNodes") ||
  preferences.includes("placeExplorerConnectionGroup")
) {
  throw new Error("Database Explorer preference action owner is invalid.");
}
if (
  !visibility.includes("hideExplorerNodes") ||
  visibility.includes("placeExplorerConnectionGroup")
) {
  throw new Error("Database Explorer visibility action owner is invalid.");
}
if (
  !groups.includes("placeExplorerConnectionGroup") ||
  groups.includes("hideExplorerNodes")
) {
  throw new Error("Database Explorer group action owner is invalid.");
}
if (!lifecycle.includes("forgetScope") || lifecycle.includes("connectionGroups")) {
  throw new Error("Database Explorer lifecycle owner must only remove scopes.");
}
if (
  !factory.includes("persist(") ||
  !factory.includes("createExplorerPreferenceActions") ||
  !factory.includes("createExplorerGroupActions")
) {
  throw new Error("Database Explorer factory must own persistence and action composition.");
}

console.log("Database Explorer store boundaries verified: contract, state, preferences, visibility, groups, lifecycle, and persistence owners are explicit.");
