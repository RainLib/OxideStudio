import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readSourceText(path.join(root, relativePath));
const facadePath = "src/features/connections/ui/ConnectionSshFields.tsx";
const jumpHostsPath = "src/features/connections/ui/SshJumpHostFields.tsx";
const workerPath = "src/features/connections/ui/RemoteSqliteWorkerFields.tsx";
const facade = read(facadePath);
const jumpHosts = read(jumpHostsPath);
const worker = read(workerPath);

for (const required of [
  'import { SshJumpHostFields } from "@/features/connections/ui/SshJumpHostFields";',
  "<SshJumpHostFields",
  'import { RemoteSqliteWorkerFields } from "@/features/connections/ui/RemoteSqliteWorkerFields";',
  "<RemoteSqliteWorkerFields",
  "sqliteWorkerBaseUrlInput={sqliteWorkerBaseUrlInput}",
  "handlePrepareSqliteWorker={handlePrepareSqliteWorker}",
]) {
  if (!facade.includes(required)) {
    throw new Error(`SSH fields facade must compose ${required}.`);
  }
}
for (const required of [
  "export function SshJumpHostFields",
  "Add jump host",
  "Remove hop",
  "Verify SSH host key for hop",
]) {
  if (!jumpHosts.includes(required)) {
    throw new Error(`SSH jump-host owner must retain ${required}.`);
  }
}
for (const forbidden of ["Add jump host", "Remove hop", "Verify SSH host key for hop"]) {
  if (facade.includes(forbidden)) {
    throw new Error(`SSH fields facade must not retain jump-host presentation ${forbidden}.`);
  }
}
for (const required of [
  "export function RemoteSqliteWorkerFields",
  "Worker placement",
  'id="sqlite-worker-path"',
  'id="sqlite-worker-source"',
  "Allow signed SQLite worker upload",
  "handlePrepareSqliteWorker",
]) {
  if (!worker.includes(required)) {
    throw new Error(`Remote SQLite worker owner must retain ${required}.`);
  }
}
for (const forbidden of [
  "Worker placement",
  'id="sqlite-worker-path"',
  'id="sqlite-worker-source"',
  "Allow signed SQLite worker upload",
]) {
  if (facade.includes(forbidden)) {
    throw new Error(`SSH fields facade must not retain worker presentation ${forbidden}.`);
  }
}

const base = "src/features/connections/ui";
const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath && [workerPath, jumpHostsPath].includes(file)) {
      throw new Error(
        `${file} imports ${specifier}; the worker owner must not depend on the SSH fields facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Connection SSH fields");
console.log(
  `Connection SSH field boundaries verified: worker placement has one owner across ${graph.size} focused field modules.`,
);
