import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facadePath = "src/services/tauri/agent-host.service.ts";
const base = "src/services/tauri/agent-host";
const facade = read(facadePath);
const owners = [
  ["artifacts", ["readAgentArtifact", "searchAgentArtifact", "exportAgentArtifact"]],
  ["conversations", ["saveAgentConversationSnapshot", "listAgentConversationSnapshots"]],
  ["events", ["listenAgentHostEvents", "isAgentHostEvent"]],
  ["status", ["getAgentHostStatus", "getAgentContextMetrics", "clearAgentProjectState"]],
  ["turns", ["startAgentTurn", "resumeAgentTurn", "approveAgentAction"]],
  ["validation", ["isAgentHostUnavailableError", "isAgentCitation"]],
];

for (const required of [
  'export * from "./agent-host/contracts";',
  "export const agentHostService",
  "getStatus: getAgentHostStatus",
  "saveConversationSnapshot: saveAgentConversationSnapshot",
  "readArtifact: readAgentArtifact",
  "startTurn: startAgentTurn",
  "listen: listenAgentHostEvents",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Agent-host client facade must retain ${required}.`);
  }
}

for (const [module, symbols] of owners) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Agent-host ${module} owner must retain ${symbol}.`);
    }
  }
}

const contracts = read(`${base}/contracts.ts`);
for (const forbidden of ["invokeRawCommand", "@tauri-apps/api/event", "agentHostService"]) {
  if (contracts.includes(forbidden)) {
    throw new Error(`Agent-host contracts must not own ${forbidden}.`);
  }
}
const validation = read(`${base}/validation.ts`);
for (const forbidden of ["invokeRawCommand", "@tauri-apps/api/event", "agentHostService"]) {
  if (validation.includes(forbidden)) {
    throw new Error(`Agent-host validation must not own ${forbidden}.`);
  }
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; agent-host capability owners must not depend on their compatibility facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Agent-host Tauri client");
console.log(
  `Agent-host client boundaries verified: stable facade, ${graph.size} capability modules, and acyclic contracts are explicit.`,
);
