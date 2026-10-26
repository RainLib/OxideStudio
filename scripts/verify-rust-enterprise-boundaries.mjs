import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/enterprise/mod.rs";
const facade = readSourceText(path.join(root, entry));
const expectedModules = ["callback", "client", "commands", "gateway_driver", "models", "session", "support"];
const modules = [...facade.matchAll(/^(?:pub )?mod (\w+);$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "tests");
if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const|impl|type)\b/m.test(facade) ||
  !facade.includes("pub use models::*;")
) {
  throw new Error(`${entry}: retain the module-only enterprise facade and stable public model exports.`);
}

const names = new Set(modules);
const graph = new Map();
let helpers = 0;
let typeMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/enterprise/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  const productionSource = source.replace(/\n#\[cfg\(test\)\][\s\S]*$/, "\n");
  if (
    /\buse\s+super::\*|\buse\s+super::\w+::\*|\buse\s+crate::enterprise(?:::\w+)?::/.test(productionSource)
  ) {
    throw new Error(`${file}: import directly from its owning enterprise module.`);
  }
  const dependencies = new Set();
  for (const match of productionSource.matchAll(/\b(?:use\s+)?super::(\w+)::/g)) {
    if (!names.has(match[1])) {
      throw new Error(`${file}: unknown enterprise dependency ${match[1]}.`);
    }
    dependencies.add(match[1]);
  }
  graph.set(module, dependencies);
  helpers += [...productionSource.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
  typeMethods += [...productionSource.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
}
assertAcyclic(graph, "Rust enterprise module");

for (const [symbol, owner] of Object.entries({
  EnterpriseClient: "models",
  receive_callback: "callback",
  save_refresh_token: "session",
  normalized_https_url: "support",
  enterprise_sign_in: "commands",
  ManagedGatewayDriver: "gateway_driver",
})) {
  const source = readSourceText(path.join(root, `src-tauri/src/enterprise/${owner}.rs`));
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`${symbol} must have one owner in ${owner}.`);
  }
}

const commands = [
  "enterprise_get_account_status",
  "enterprise_get_public_config",
  "enterprise_get_managed_device_enrollment",
  "enterprise_configure_account",
  "enterprise_sign_in",
  "enterprise_sync_projects",
  "enterprise_sign_out",
  "enterprise_connect_managed_source",
];
const lib = readSourceText(path.join(root, "src-tauri/src/lib.rs"));
for (const command of commands) {
  if (!new RegExp(`\\benterprise::commands::${command},`).test(lib)) {
    throw new Error(`${command} must be registered from enterprise/commands.rs.`);
  }
}
const catalogFile = "src-tauri/src/enterprise/gateway_driver/default_database.rs";
const catalog = readSourceText(path.join(root, catalogFile));
if (!/mod default_database;/.test(readSourceText(path.join(root, "src-tauri/src/enterprise/gateway_driver.rs"))) ||
    !/pub\(super\) fn sole_catalog\(/.test(catalog) ||
    /EnterpriseClient|ConnectionManager|DataPlaneClient/.test(catalog)) {
  throw new Error(`${catalogFile}: keep single-catalog resolution pure and owned by the managed driver.`);
}
const testFiles = ["tests", "gateway_driver", "gateway_driver/default_database"];
const testCount = testFiles.reduce((count, file) => count + [
  ...readSourceText(path.join(root, `src-tauri/src/enterprise/${file}.rs`))
    .matchAll(/^\s*#\[(?:tokio::)?test\]$/gm),
].length, 0);
if (helpers !== 37 || typeMethods !== 57 || testCount !== 14) {
  throw new Error(`Expected 37 enterprise helpers, 57 type methods and 14 tests; found ${helpers}, ${typeMethods} and ${testCount}.`);
}
console.log(
  `Rust enterprise boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} type methods, ${commands.length} Tauri commands, ${testCount} tests, acyclic imports.`,
);
