import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "enterprise/control-plane/src/api.rs";
const facade = readSourceText(path.join(root, entry));
const modules = ["access", "admin", "gateway", "identity", "models", "support"];
const declared = [...facade.matchAll(/^mod (\w+);$/gm)].map((match) => match[1]);
if (
  modules.some((name, index) => declared[index] !== name) ||
  !facade.includes("#[cfg(test)]\nmod tests;") ||
  !facade.includes("pub use models::AppState;") ||
  !facade.includes("pub fn router(state: AppState) -> Router")
) {
  throw new Error(`${entry}: retain the API facade, stable AppState export, and isolated tests.`);
}

const dependencies = {
  access: ["models", "support"],
  admin: ["access", "models", "support"],
  gateway: ["models", "support"],
  identity: ["models"],
  models: [],
  support: ["models"],
};
const graph = new Map();
for (const module of modules) {
  const file = `enterprise/control-plane/src/api/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::api(?:::\w+)?::/.test(source)) {
    throw new Error(`${file}: import directly from its API owner.`);
  }
  for (const dependency of dependencies[module]) {
    if (!new RegExp(`\\b${dependency}(?:::|::\\*)`).test(source)) {
      throw new Error(`${file}: expected direct dependency on ${dependency}.`);
    }
  }
  graph.set(module, new Set(dependencies[module]));
}
assertAcyclic(graph, "control-plane API module");

for (const [symbol, owner] of Object.entries({
  create_access_session: "access",
  validate_access_session_request: "access",
  register_gateway: "gateway",
  gateway_revocation_snapshot: "gateway",
  create_access_grant: "admin",
  register_managed_device: "admin",
  managed_projects: "identity",
  ApiError: "models",
  normalize_certificate_fingerprint: "support",
  require_admin: "support",
})) {
  const source = readSourceText(path.join(root, `enterprise/control-plane/src/api/${owner}.rs`));
  if (!new RegExp(`\\b${symbol}\\b`).test(source)) {
    throw new Error(`${symbol} must have one owner in ${owner}.`);
  }
}
const tests = [
  ...readSourceText(path.join(root, "enterprise/control-plane/src/api/tests.rs"))
    .matchAll(/^\s*#\[(?:tokio::)?test\]$/gm),
].length;
if (tests !== 10) throw new Error(`Expected 10 control-plane API tests; found ${tests}.`);
console.log(`Control-plane API boundaries verified: ${modules.length} modules, ${tests} tests, acyclic imports.`);
