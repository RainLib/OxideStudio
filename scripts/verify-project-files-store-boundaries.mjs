import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readSourceText(path.join(root, file));
const facade = read("src/store/useProjectFilesStore.ts");
const moduleRoot = "src/store/project-files";

for (const required of [
  "createProjectFilesStore",
  "selectProjectFileTree",
  "useProjectStore.subscribe",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Project files store facade must retain ${required}.`);
  }
}

const contracts = read(`${moduleRoot}/contracts.ts`);
const cache = read(`${moduleRoot}/cache.ts`);
const runtime = read(`${moduleRoot}/runtime.ts`);
const projectActions = read(`${moduleRoot}/projectActions.ts`);
const directoryActions = read(`${moduleRoot}/directoryActions.ts`);
const documentActions = read(`${moduleRoot}/documentActions.ts`);
const factory = read(`${moduleRoot}/createProjectFilesStore.ts`);
const tree = read(`${moduleRoot}/tree.ts`);

for (const source of [
  contracts,
  cache,
  runtime,
  projectActions,
  directoryActions,
  documentActions,
  factory,
  tree,
]) {
  if (source.includes("useProjectFilesStore")) {
    throw new Error("Project files store owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("projectFilesService") || cache.includes("projectFilesService")) {
  throw new Error("Project files contracts and cache must remain transport-free.");
}
if (!runtime.includes("createProjectFileOperationRuntime") || runtime.includes("projectFilesService")) {
  throw new Error("Project files runtime must own context and operation state only.");
}
if (!projectActions.includes("setProjectRoot") || projectActions.includes("readProjectFile")) {
  throw new Error("Project files project action owner is invalid.");
}
if (!directoryActions.includes("listProjectEntries") || directoryActions.includes("writeProjectFile")) {
  throw new Error("Project files directory action owner is invalid.");
}
if (!documentActions.includes("writeProjectFile") || !documentActions.includes("renameProjectEntry")) {
  throw new Error("Project files document action owner is invalid.");
}
if (!factory.includes("createProjectFileProjectActions") || !factory.includes("createProjectFileDocumentActions")) {
  throw new Error("Project files store factory must compose every action owner.");
}
if (!tree.includes("selectProjectFileTree") || tree.includes("zustand")) {
  throw new Error("Project files tree projection must remain independent from Zustand.");
}

console.log("Project files store boundaries verified: contract, cache, runtime, project, directory, document, and tree owners are explicit.");
