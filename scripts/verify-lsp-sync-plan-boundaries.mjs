import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/services/lsp/syncPlan.ts");
const moduleRoot = "src/services/lsp/sync-plan";

for (const module of ["types", "catalog", "plan", "mappings", "configKey"]) {
  if (!facade.includes(`./sync-plan/${module}`)) {
    throw new Error(`LSP sync-plan facade must re-export ${module}.`);
  }
}

const types = read(`${moduleRoot}/types.ts`);
const catalog = read(`${moduleRoot}/catalog.ts`);
const plan = read(`${moduleRoot}/plan.ts`);
const mappings = read(`${moduleRoot}/mappings.ts`);
const configKey = read(`${moduleRoot}/configKey.ts`);
for (const source of [types, catalog, plan, mappings, configKey]) {
  if (source.includes("syncPlan\"")) {
    throw new Error("LSP sync-plan owners cannot import their compatibility facade.");
  }
}
if (types.includes("@/lib/") || types.includes("import {")) {
  throw new Error("LSP sync-plan types must remain free of runtime dependencies.");
}
if (!catalog.includes("supportsLspConnectionCatalogs") || catalog.includes("extractRelationReferences")) {
  throw new Error("LSP catalog owner must not absorb relation planning.");
}
if (!plan.includes("extractRelationReferences") || plan.includes("getLspDocumentUri")) {
  throw new Error("LSP plan owner must retain relation discovery only.");
}
if (!mappings.includes("getLspDocumentUri") || mappings.includes("extractRelationReferences")) {
  throw new Error("LSP file-mapping owner is invalid.");
}
if (!configKey.includes("lspSchemaSignature") || configKey.includes("getLspDocumentUri")) {
  throw new Error("LSP configuration-key owner is invalid.");
}

console.log("LSP sync-plan boundaries verified: contract, catalog, relation plan, file mappings, and config-key owners are explicit.");
