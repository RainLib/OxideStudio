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
const facadePath = "src/services/tauri/client.ts";
const base = "src/services/tauri/client";
const facade = read(facadePath);

for (const required of [
  'export { normalizeInvokeError } from "./client/errorNormalization";',
  'export { interceptors } from "./client/interceptors";',
  'export { invokeCommand, invokeRawCommand } from "./client/invoke";',
  'export { invokeWithInterceptors } from "./client/invokeWithInterceptors";',
  "installDevelopmentLogging();",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Tauri client facade must retain ${required}.`);
  }
}

const ownership = {
  contracts: ["CommandArguments", "RequestInterceptor", "ResponseInterceptor"],
  errorNormalization: [
    "normalizeInvokeError",
    "safeCommandContext",
    "commandFailureCode",
    "commandCategory",
  ],
  interceptors: [
    "class InterceptorManager",
    "addRequestInterceptor",
    "runResponseInterceptors",
  ],
  invoke: ["invokeCommand", "invokeRawCommand", "@tauri-apps/api/core"],
  invokeWithInterceptors: ["invokeWithInterceptors", "runErrorInterceptors"],
  developmentLogging: ["installDevelopmentLogging", "redactSecrets"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Tauri client ${module} owner must retain ${symbol}.`);
    }
  }
}

for (const module of ["contracts", "errorNormalization", "interceptors"]) {
  if (read(`${base}/${module}.ts`).includes("@tauri-apps/api/core")) {
    throw new Error(`Tauri client ${module} must remain independent of invoke transport.`);
  }
}
if (read(`${base}/errorNormalization.ts`).includes("interceptors")) {
  throw new Error("Tauri error normalization must remain independent of interceptor runtime.");
}
if (read(`${base}/invoke.ts`).includes("runRequestInterceptors")) {
  throw new Error("Tauri envelope dispatch must remain independent of interceptor lifecycle.");
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; Tauri client owners must not depend on the compatibility facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Tauri client");
console.log(
  `Tauri client boundaries verified: stable facade, ${graph.size} transport lifecycle modules, and acyclic error/interceptor ownership are explicit.`,
);
