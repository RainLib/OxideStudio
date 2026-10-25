import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/drivers/mysql.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["driver", "models", "runtime", "values"];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");

if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use models::MysqlDriver;")
) throw new Error(`${entry}: retain a module-only facade and the public driver export.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let helpers = 0;
let driverMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/drivers/mysql/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::drivers::mysql::/.test(source))
    throw new Error(`${file}: import directly from its owning MySQL module.`);

  const dependencies = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown MySQL dependency ${match[1]}.`);
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);

  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|type)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate MySQL owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) helpers++;
  }
  if (source.includes("impl MysqlDriver") || source.includes("impl DatabaseDriver for MysqlDriver")) {
    for (const match of source.matchAll(/^    (?:pub(?:\(super\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate MySQL method owners.`);
      definitions.set(match[1], module);
      driverMethods++;
    }
  }
}

assertAcyclic(graph, "Rust MySQL driver");
for (const [symbol, owner] of Object.entries({
  MysqlDriver: "models", MysqlTransactionSession: "models",
  MysqlTrackedQueryGuard: "models", mysql_requires_unprepared: "models",
  new: "runtime", process_rows: "runtime", cancel_tracked_queries_on_pool: "runtime",
  get_transaction_session: "runtime", statement_scan_dialect: "driver",
  begin_database_transaction: "driver", get_schema_objects: "driver",
  decode_mysql_value: "values", bind_mysql_parameter: "values",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);

if (helpers !== 27 || driverMethods !== 48)
  throw new Error(`Expected 27 MySQL helpers and 48 driver methods; found ${helpers} and ${driverMethods}.`);

const tests = readSourceText(path.join(root, "src-tauri/src/drivers/mysql/tests.rs"));
const testCount = [...tests.matchAll(/^#\[(?:tokio::)?test\]$/gm)].length;
if (testCount !== 21) throw new Error(`Expected 21 MySQL regression scenarios; found ${testCount}.`);

console.log(`Rust MySQL driver boundaries verified: ${modules.length} modules, ${helpers} helpers, ${driverMethods} methods, ${testCount} tests, acyclic imports.`);
