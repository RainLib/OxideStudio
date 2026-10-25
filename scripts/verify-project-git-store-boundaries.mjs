import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readSourceText(path.join(root, file));
const facade = read("src/store/useProjectGitStore.ts");
const moduleRoot = "src/store/project-git";

for (const required of [
  "createProjectGitStore",
  "EMPTY_GIT_REPOSITORY",
  "VersionControlView",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Project Git store facade must retain ${required}.`);
  }
}

const contracts = read(`${moduleRoot}/contracts.ts`);
const runtime = read(`${moduleRoot}/runtime.ts`);
const actions = read(`${moduleRoot}/actions.ts`);
const factory = read(`${moduleRoot}/createProjectGitStore.ts`);

for (const source of [contracts, runtime, actions, factory]) {
  if (source.includes("useProjectGitStore")) {
    throw new Error("Project Git store owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("projectGitService") || contracts.includes("zustand\";\nimport {")) {
  throw new Error("Project Git store contract must remain transport-free.");
}
if (
  !runtime.includes("createProjectGitRuntime") ||
  !runtime.includes("runOperation") ||
  runtime.includes("getPatch")
) {
  throw new Error("Project Git runtime must own refresh and operation lifecycle only.");
}
if (
  !actions.includes("getPatch") ||
  !actions.includes("getCommitFiles") ||
  !actions.includes("createBranch")
) {
  throw new Error("Project Git action owner must retain repository and detail commands.");
}
if (
  !factory.includes("createProjectGitRuntime") ||
  !factory.includes("createProjectGitActions") ||
  !factory.includes("ensureSession")
) {
  throw new Error("Project Git factory must compose session, runtime, and action owners.");
}

console.log("Project Git store boundaries verified: contract, session factory, operation runtime, and repository actions are explicit.");
