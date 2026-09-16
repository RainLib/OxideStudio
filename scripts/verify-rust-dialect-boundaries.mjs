import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/core/dialect.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = ["catalog", "sql", "types"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|impl)\b/m.test(facade) ||
  !facade.includes("pub use catalog::*;") ||
  !facade.includes("pub use sql::*;") ||
  !facade.includes("pub use types::*;")
) throw new Error(`${entry}: retain a module-only capability facade and stable public exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
for (const module of modules) {
  const file = `src-tauri/src/core/dialect/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  if (/\buse\s+super::\*|\buse\s+crate::core::dialect::/.test(source))
    throw new Error(`${file}: import directly from its dialect owner.`);
  const dependencies = new Set();
  for (const candidate of names) {
    if (candidate !== module && new RegExp(`\\b${candidate}::`).test(source)) dependencies.add(candidate);
  }
  graph.set(module, dependencies);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|static|type)\s+(\w+)/gm)) {
    const symbol = match[1];
    if (definitions.has(symbol) && definitions.get(symbol) !== module)
      throw new Error(`${symbol} has duplicate dialect owners.`);
    definitions.set(symbol, module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
}
assertAcyclic(graph, "Rust dialect");
for (const [symbol, owner] of Object.entries({
  DatabaseCapabilities: "types", DatabaseSpec: "types", HOST_TABLE_EXPORT_FORMATS: "types",
  database_spec_for_driver: "catalog", canonical_driver_name: "catalog",
  database_capabilities_for_driver: "catalog", DatabaseKind: "sql",
  normalize_data_type: "sql", postgres_cast_type: "sql",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

const sql = fs.readFileSync(path.join(root, "src-tauri/src/core/dialect/sql.rs"), "utf8");
const methods = [...sql.matchAll(/^    pub fn (\w+)/gm)].map((match) => match[1]);
if (helpers !== 21 || methods.length !== 40)
  throw new Error(`Expected 21 dialect helpers and 40 DatabaseKind methods; found ${helpers} and ${methods.length}.`);
if (!fs.existsSync(path.join(root, "src-tauri/src/core/dialect/tests.rs")))
  throw new Error("Dialect tests must remain separate from production modules.");
console.log(`Rust dialect boundaries verified: ${modules.length} modules, ${helpers} helpers, ${methods.length} DatabaseKind methods, one test module, acyclic imports.`);
