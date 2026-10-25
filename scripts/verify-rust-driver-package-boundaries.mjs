import { readSourceText } from "./lib/source-text.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertAcyclic } from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "src-tauri/src/core/driver_package.rs";
const facade = readSourceText(path.join(root, entry));
const modules = [...facade.matchAll(/^mod (\w+);$/gm)]
  .map((match) => match[1]).filter((name) => name !== "tests");
if (
  modules.length !== 20 ||
  /^(?:pub(?:\([^)]*\))?\s+)?(?:fn|struct|enum|const|impl)\b/m.test(facade) ||
  !facade.includes("pub use oxide_driver_protocol::DRIVER_PROTOCOL_VERSION;") ||
  !facade.includes("pub use handshake::validate_handshake;") ||
  !facade.includes("pub use package_identity::is_safe_driver_package_token;") ||
  !facade.includes("pub use version_policy::validate_server_version_compatibility;")
) throw new Error(`${entry}: keep the driver package entry to modules and stable exports.`);

const names = new Set(modules);
const graph = new Map();
const definitions = new Map();
let functions = 0;
let registryMethods = 0;
for (const module of modules) {
  const file = `src-tauri/src/core/driver_package/${module}.rs`;
  const source = readSourceText(path.join(root, file));
  if (/\buse\s+super::\*|\buse\s+crate::core::driver_package::/.test(source))
    throw new Error(`${file}: import directly from the owning driver package module.`);
  const deps = new Set();
  for (const match of source.matchAll(/\buse\s+super::(\w+)::/g)) {
    if (!names.has(match[1])) throw new Error(`${file}: unknown driver package dependency ${match[1]}.`);
    deps.add(match[1]);
  }
  graph.set(module, deps);
  for (const match of source.matchAll(/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:fn|struct|enum|const)\s+(\w+)/gm)) {
    if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate driver package owners.`);
    definitions.set(match[1], module);
    if (/(?:^|\s)fn\s/.test(match[0])) functions++;
  }
  if (source.includes("impl DatabaseDriverPackageRegistry {")) {
    for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate registry method owners.`);
      definitions.set(match[1], module);
      registryMethods++;
    }
  }
  if (source.includes("impl InstalledDriverPackage {")) {
    for (const match of source.matchAll(/^    (?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm)) {
      if (definitions.has(match[1])) throw new Error(`${match[1]} has duplicate installed package method owners.`);
      definitions.set(match[1], module);
    }
  }
}
assertAcyclic(graph, "Rust driver package");
for (const [symbol, owner] of Object.entries({
  DriverPackageManifest: "types", DatabaseDriverPackageRegistry: "types",
  has_exact_migration_evidence: "package_identity",
  new: "registry_core", fetch_signed_catalog: "catalog_registry",
  install_from_directory: "installation", resolve_active: "resolution", resolve_preferred: "resolution",
  install_managed_java_runtime_from_directory: "java_runtime",
  validate_catalog_manifest_binding: "catalog_binding",
  copy_driver_store_tree: "store_copy", validate_handshake: "handshake",
  validate_manifest: "package_validation", validate_capability_contract: "package_contracts",
  validate_server_version_compatibility: "version_policy",
  is_safe_token: "package_identity", download_catalog_dependency: "downloads",
  prune_catalog_cache_files: "cache", unpack_driver_package_archive: "archive",
  validate_driver_catalog: "catalog_validation", verify_package_signature: "signature",
})) if (definitions.get(symbol) !== owner)
  throw new Error(`${symbol} must have one owner in ${owner}.`);
if (functions !== 78 || registryMethods !== 23)
  throw new Error(`Expected 78 package functions and 23 registry methods; found ${functions} and ${registryMethods}.`);
const tests = ["support", "catalog", "dependencies", "archives", "contracts", "registry", "handshake", "security", "file_query_contract"];
const testFolder = path.join(root, "src-tauri/src/core/driver_package/tests");
if (tests.some((name) => !fs.existsSync(path.join(testFolder, `${name}.rs`))))
  throw new Error("Driver package tests must remain split by scenario.");
console.log(`Rust driver package boundaries verified: ${modules.length} modules, ${functions} functions, ${registryMethods} registry methods, ${tests.length} test modules, acyclic imports.`);
