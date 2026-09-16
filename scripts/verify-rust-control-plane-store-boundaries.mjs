import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "enterprise/control-plane/src/store.rs";
const facade = fs.readFileSync(path.join(root, entry), "utf8");
const expectedModules = [
  "access",
  "administration",
  "audit",
  "crypto",
  "data_sources",
  "devices",
  "gateways",
  "identity",
  "memberships",
  "models",
  "organization",
  "support",
];
const modules = [...facade.matchAll(/^mod (\w+);$/gm)].map((match) => match[1]);
if (
  modules.length !== expectedModules.length ||
  expectedModules.some((name, index) => modules[index] !== name) ||
  !facade.includes("pub(crate) use access::allowed_paths_for_action;") ||
  !facade.includes("pub use models::ControlPlaneStore;") ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|impl|type)\b/m.test(facade)
) {
  throw new Error(`${entry}: retain the module-only control-plane store facade and stable exports.`);
}

const dependencies = {
  access: ["audit", "models"],
  administration: ["models"],
  audit: [],
  crypto: [],
  data_sources: ["access", "audit", "models"],
  devices: ["audit", "crypto", "models"],
  gateways: ["audit", "crypto", "models"],
  identity: ["models"],
  memberships: ["audit", "models", "support"],
  models: [],
  organization: ["audit", "models"],
  support: [],
};
const graph = new Map();
let helpers = 0;
let typeMethods = 0;
let tests = 0;
for (const module of modules) {
  const file = `enterprise/control-plane/src/store/${module}.rs`;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const productionSource = source.replace(/\n#\[cfg\(test\)\][\s\S]*$/, "\n");
  if (/\buse\s+super::\*|\buse\s+crate::store(?:::\w+)?::/.test(productionSource)) {
    throw new Error(`${file}: import directly from the owning control-plane store module.`);
  }
  for (const dependency of dependencies[module]) {
    if (!new RegExp(`\\b${dependency}::`).test(productionSource)) {
      throw new Error(`${file}: expected direct dependency on ${dependency}.`);
    }
  }
  graph.set(module, new Set(dependencies[module]));
  helpers += [...productionSource.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm)].length;
  typeMethods += [
    ...productionSource.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+\w+/gm),
  ].length;
  tests += [...source.matchAll(/^\s*#\[(?:tokio::)?test\]$/gm)].length;
}
assertAcyclic(graph, "control-plane store module");

for (const [symbol, owner] of Object.entries({
  ControlPlaneStore: "models",
  create_organization: "organization",
  register_gateway: "gateways",
  register_data_source: "data_sources",
  sync_identity: "identity",
  register_managed_device: "devices",
  suspend_member: "memberships",
  create_access_grant: "access",
  admin_overview: "administration",
  write_management_audit: "audit",
  verify_gateway_signature: "crypto",
  parse_membership_status: "support",
})) {
  const source = fs.readFileSync(
    path.join(root, `enterprise/control-plane/src/store/${owner}.rs`),
    "utf8",
  );
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`${symbol} must have one owner in ${owner}.`);
  }
}

if (helpers !== 13 || typeMethods !== 36 || tests !== 5) {
  throw new Error(
    `Expected 13 helpers, 36 ControlPlaneStore methods and 5 tests; found ${helpers}, ${typeMethods} and ${tests}.`,
  );
}
console.log(
  `Control-plane store boundaries verified: ${modules.length} modules, ${helpers} helpers, ${typeMethods} methods, ${tests} tests, acyclic imports.`,
);
