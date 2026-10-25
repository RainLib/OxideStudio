import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readSourceText(path.join(root, file));
const facade = read("src/store/useProjectStore.ts");
const moduleRoot = "src/store/project";

for (const required of ["createProjectStore", "ProjectState", "DEFAULT_PROJECT"]) {
  if (!facade.includes(required)) {
    throw new Error(`Project store facade must retain ${required}.`);
  }
}

const contracts = read(`${moduleRoot}/contracts.ts`);
const identity = read(`${moduleRoot}/identity.ts`);
const enterprise = read(`${moduleRoot}/enterprise.ts`);
const epoch = read(`${moduleRoot}/switchEpoch.ts`);
const workspace = read(`${moduleRoot}/workspace.ts`);
const loading = read(`${moduleRoot}/loadingActions.ts`);
const actions = read(`${moduleRoot}/projectActions.ts`);
const factory = read(`${moduleRoot}/createProjectStore.ts`);

for (const source of [
  contracts,
  identity,
  enterprise,
  epoch,
  workspace,
  loading,
  actions,
  factory,
]) {
  if (source.includes("useProjectStore")) {
    throw new Error("Project store owners cannot import their compatibility facade.");
  }
}
if (identity.includes("useConnectionStore") || identity.includes("storeService")) {
  throw new Error("Project identity must remain independent from workspace and persistence commands.");
}
if (!enterprise.includes("useEnterpriseAccountStore") || enterprise.includes("replaceProjectWorkspace")) {
  throw new Error("Project enterprise owner must only map managed projects and connections.");
}
if (!workspace.includes("unstable_batchedUpdates") || workspace.includes("saveProject")) {
  throw new Error("Project workspace owner must only coordinate cross-store replacement.");
}
if (!loading.includes("loadProjects") || !loading.includes("reconcileManagedProjects")) {
  throw new Error("Project loading owner must retain hydration and managed-project reconciliation.");
}
if (
  !actions.includes("setActiveProject") ||
  !actions.includes("createProject") ||
  !actions.includes("deleteProject")
) {
  throw new Error("Project action owner must retain switching and CRUD mutations.");
}
if (
  !factory.includes("createProjectLoadingActions") ||
  !factory.includes("createProjectActions")
) {
  throw new Error("Project store factory must compose loading and mutation owners.");
}

console.log("Project store boundaries verified: contract, identity, enterprise mapping, switch epoch, workspace, loading, and mutation owners are explicit.");
