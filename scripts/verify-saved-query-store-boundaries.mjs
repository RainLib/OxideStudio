import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/store/useSavedQueryStore.ts");
const moduleRoot = "src/store/saved-queries";

for (const required of [
  "createSavedQueryStore",
  "SavedQueryTarget",
  "SavedQueryState",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Saved query store facade must retain ${required}.`);
  }
}

const contracts = read(`${moduleRoot}/contracts.ts`);
const state = read(`${moduleRoot}/state.ts`);
const migration = read(`${moduleRoot}/legacyMigration.ts`);
const loading = read(`${moduleRoot}/loadingActions.ts`);
const folders = read(`${moduleRoot}/folderActions.ts`);
const files = read(`${moduleRoot}/fileActions.ts`);
const importing = read(`${moduleRoot}/importActions.ts`);
const factory = read(`${moduleRoot}/createSavedQueryStore.ts`);

for (const source of [
  contracts,
  state,
  migration,
  loading,
  folders,
  files,
  importing,
  factory,
]) {
  if (source.includes("useSavedQueryStore")) {
    throw new Error("Saved query store owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("savedSqlService") || state.includes("savedSqlService")) {
  throw new Error("Saved query contracts and state helpers must remain transport-free.");
}
if (!migration.includes("localStorage") || !migration.includes("saveBatch")) {
  throw new Error("Saved query legacy migration must own legacy persistence only.");
}
if (!loading.includes("loadLibrary") || !loading.includes("migrateLegacySavedQueries")) {
  throw new Error("Saved query loading owner must retain project hydration and migration sequencing.");
}
if (!folders.includes("saveFolder") || folders.includes("saveFile")) {
  throw new Error("Saved query folder owner must not absorb file mutations.");
}
if (!files.includes("loadFile") || !files.includes("saveFile") || files.includes("saveBatch")) {
  throw new Error("Saved query file owner must retain hydration and file CRUD only.");
}
if (!importing.includes("saveBatch") || importing.includes("loadFile")) {
  throw new Error("Saved query import owner must retain atomic batch persistence only.");
}
if (
  !factory.includes("createSavedQueryLoadingActions") ||
  !factory.includes("createSavedQueryImportActions")
) {
  throw new Error("Saved query factory must compose every action owner.");
}

console.log("Saved query store boundaries verified: contract, state, legacy migration, loading, folder, file, and import owners are explicit.");
