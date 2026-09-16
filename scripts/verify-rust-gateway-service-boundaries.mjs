import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "enterprise/gateway/src/service.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const modules = ["authorization", "driver", "models", "policy", "protocol", "rpc", "session"];
const declared = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
if (declared.length !== modules.length || modules.some((name, index) => declared[index] !== name) || !facade.includes("pub use models::DataPlaneService;")) throw new Error(`${entry}: retain the module-only Gateway service facade.`);
const dependencies = { authorization: ["policy"], driver: ["models"], models: [], policy: [], protocol: [], rpc: ["authorization", "models", "policy", "protocol"], session: ["authorization", "models"] };
const graph = new Map();
let helpers = 0;
for (const module of modules) {
  const source = fs.readFileSync(path.join(root, `enterprise/gateway/src/service/${module}.rs`), "utf8");
  if (/\buse\s+super::\*/.test(source)) throw new Error(`${module}: import directly from its owner.`);
  for (const dependency of dependencies[module]) if (!new RegExp(`\\b${dependency}::`).test(source)) throw new Error(`${module}: missing direct ${dependency} dependency.`);
  graph.set(module, new Set(dependencies[module]));
  helpers += [...source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Gateway service module");
for (const [symbol, owner] of Object.entries({ DataPlaneService: "models", authorize_sql_relations: "authorization", validate_native_read_only: "policy", encode_bounded_results: "protocol" })) if (!fs.readFileSync(path.join(root, `enterprise/gateway/src/service/${owner}.rs`), "utf8").includes(symbol)) throw new Error(`${symbol} must be owned by ${owner}.`);
if (helpers !== 25) throw new Error(`Expected 25 Gateway service helpers; found ${helpers}.`);
console.log(`Gateway service boundaries verified: ${modules.length} modules, ${helpers} helpers, acyclic imports.`);
