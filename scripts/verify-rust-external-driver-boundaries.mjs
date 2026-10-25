import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/external.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["conversions", "driver", "lookup_context", "migration", "models", "runtime"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use models::ExternalDriver;")
) throw new Error(`${entry}: retain the module-only external driver facade and stable driver export.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/external/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::drivers::external(?:::\w+)?::/.test(source))
    throw new Error(`${file}: import directly from its owning external-driver module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown external-driver dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate external-driver owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate external-driver method owners.`);
    definitions.set(match[1], module);
    typeMethods++;
  }
}

assertAcyclic(graph, "Rust external driver module");
for (const [symbol, owner] of Object.entries({
  ExternalDriver: "models", package_identity: "models", start_connected_sidecar: "runtime",
  query_result_from_sidecar: "conversions", external_statement_scan_dialect: "conversions",
  validate_semantic_snapshot: "migration", validate_schema_migration_plan_result: "migration",
  connect: "driver", plan_schema_migration: "driver", get_object_source: "driver",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 17 || typeMethods !== 74)
  throw new Error(`Expected 17 external-driver helpers and 74 type methods; found ${helpers} and ${typeMethods}.`);

const tests = readSourceText(path.join(root, "src-tauri/src/drivers/external/tests.rs"));
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 9) throw new Error(`Expected 9 external-driver regression scenarios; found ${testCount}.`);

console.log(`Rust external driver boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${testCount} tests, acyclic imports.`);
