import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src/store/workspaceDataStores.ts";
const graph = new Map();
const forbidden = new Set([
  "src/store/useConnectionStore.ts",
  "src/store/useSchemaStore.ts",
  entry,
]);
const implementation = /src\/features\/(connections|schema-metadata)\//;

function visit(file) {
  if (graph.has(file)) return;
  const dependencies = new Set();
  for (const { resolved: dependency } of readRuntimeImports(root, file)) {
    if (!dependency) continue;
    if (implementation.test(file) && forbidden.has(dependency)) {
      throw new Error(
        `${file} imports ${dependency}; inject cross-store access through workspaceDataStores instead.`,
      );
    }
    dependencies.add(dependency);
  }
  graph.set(file, dependencies);
  dependencies.forEach(visit);
}

visit(entry);
assertAcyclic(graph, "Workspace store");
console.log(
  `Workspace store boundaries verified: ${graph.size} reachable modules, no runtime import cycles.`,
);
