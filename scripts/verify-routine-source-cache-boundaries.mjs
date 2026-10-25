import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic, listTypeScriptModules, readRuntimeImports } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facadePath = "src/services/routineSourceCache.ts";
const base = "src/services/routine-source-cache";
const facade = read(facadePath);

for (const required of [
  'export { RoutineSourceCache } from "./routine-source-cache/cache";',
  'export type { RoutineSourceIdentity } from "./routine-source-cache/contracts";',
  'export {\n  routineSourceCacheKey,\n  routineSourceCacheScope,\n} from "./routine-source-cache/identity";',
  'export {\n  invalidateRoutineSourceCache,\n  loadPostgresRoutineDefinitions,\n  resetRoutineSourceCacheForTests,\n} from "./routine-source-cache/runtime";',
]) if (!facade.includes(required)) throw new Error(`Routine source facade must retain ${required}.`);

for (const [module, symbols] of Object.entries({
  contracts: ["RoutineSourceIdentity", "RoutineSourceInvalidationIdentity"],
  cache: ["export class RoutineSourceCache", "invalidatePrefix", "prune("],
  identity: ["routineSourceCacheScope", "routineSourceCacheKey", "resolvedRoutineIdentity"],
  runtime: ["loadPostgresRoutineDefinitions", "invalidateRoutineSourceCache"],
})) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) if (!source.includes(symbol)) throw new Error(`Routine source ${module} owner must retain ${symbol}.`);
}
if (read(`${base}/cache.ts`).includes("getPostgresRoutineDefinitions")) throw new Error("Routine source cache mechanics must remain transport-free.");
if (read(`${base}/identity.ts`).includes("RoutineSourceCache")) throw new Error("Routine source identity must remain cache-runtime independent.");

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) throw new Error(`${file} imports ${specifier}; routine source owners must not depend on the compatibility facade.`);
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Routine source cache");
console.log(`Routine source cache boundaries verified: stable facade, ${graph.size} cache, identity, and transport modules are explicit.`);
