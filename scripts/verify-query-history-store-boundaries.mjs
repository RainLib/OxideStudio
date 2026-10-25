import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readSourceText(path.join(root, file));
const facade = read("src/store/useHistoryStore.ts");
const moduleRoot = "src/store/query-history";
const contracts = read(`${moduleRoot}/contracts.ts`);
const state = read(`${moduleRoot}/state.ts`);
const legacy = read(`${moduleRoot}/legacyMigration.ts`);
const runtime = read(`${moduleRoot}/runtime.ts`);
const loading = read(`${moduleRoot}/loadingActions.ts`);
const mutations = read(`${moduleRoot}/mutationActions.ts`);
const factory = read(`${moduleRoot}/createHistoryStore.ts`);

if (!facade.includes("createHistoryStore")) {
  throw new Error("Query history facade must retain the store factory.");
}
for (const source of [contracts, state, legacy, runtime, loading, mutations, factory]) {
  if (source.includes("useHistoryStore")) {
    throw new Error("Query history owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("queryHistoryService") || state.includes("queryHistoryService")) {
  throw new Error("Query history contracts and state helpers must stay transport free.");
}
if (!legacy.includes("localStorage") || legacy.includes("queryHistoryService")) {
  throw new Error("Query history legacy owner must only read and clear browser storage.");
}
if (!runtime.includes("enqueueHistoryMutation") || runtime.includes("queryHistoryService")) {
  throw new Error("Query history runtime must own only load epochs and mutation serialization.");
}
if (!loading.includes("loadHistory") || !loading.includes("readLegacyQueryHistory")) {
  throw new Error("Query history loading owner must retain hydration and legacy migration.");
}
if (
  !mutations.includes("recordExecution") ||
  !mutations.includes("removeHistory") ||
  !mutations.includes("clearHistory")
) {
  throw new Error("Query history mutation owner must retain optimistic write and rollback flows.");
}
if (
  !factory.includes("createHistoryLoadingActions") ||
  !factory.includes("createHistoryMutationActions")
) {
  throw new Error("Query history factory must compose loading and mutation owners.");
}

console.log(
  "Query history store boundaries verified: contracts, state helpers, legacy migration, runtime, loading, and optimistic mutations are explicit.",
);
