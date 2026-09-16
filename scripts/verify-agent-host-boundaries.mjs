import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "agent-host/src";
const files = listTypeScriptModules(root, base);
const facades = new Set([`${base}/runtime.ts`, `${base}/tools.ts`]);
const graph = new Map();
for (const file of files) {
  const implementation =
    file.startsWith(`${base}/runtime/`) || file.startsWith(`${base}/tools/`);
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file, {
    includeDynamic: true,
  })) {
    if (implementation && facades.has(resolved))
      throw new Error(
        `${file} imports ${specifier}; agent implementations must not depend on compatibility facades.`,
      );
    if (
      file.startsWith(`${base}/tools/`) &&
      resolved?.startsWith(`${base}/runtime/`)
    )
      throw new Error(
        `${file} imports ${specifier}; tool implementations consume execution types, not runtime initialization.`,
      );
    if (
      file === `${base}/runtime/execution.ts` &&
      resolved?.startsWith(`${base}/tools/`)
    )
      throw new Error(
        `${file} imports ${specifier}; turn state must not depend on tool registration or invocation.`,
      );
    if (
      [
        `${base}/rpc.ts`,
        `${base}/model.ts`,
        `${base}/checkpointer.ts`,
      ].includes(file) &&
      (facades.has(resolved) || resolved === `${base}/runtime/agentRuntime.ts`)
    )
      throw new Error(
        `${file} imports ${specifier}; transport adapters must not depend on runtime composition.`,
      );
    if (
      resolved?.startsWith("src/") ||
      resolved?.startsWith("enterprise/") ||
      specifier === "react" ||
      specifier.startsWith("react/")
    )
      throw new Error(
        `${file} imports ${specifier}; the sidecar must remain independent of desktop and administration UI.`,
      );
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Agent host");
console.log(
  `Agent host boundaries verified: ${graph.size} modules, no runtime cycles or reverse composition dependencies.`,
);
