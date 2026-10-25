import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readSourceText(path.join(root, file));
const facade = read("src/services/lsp/schemaConfig.ts");
const moduleRoot = "src/services/lsp/schema-config";

for (const module of ["types", "collections", "signature", "selection"]) {
  if (!facade.includes(`./schema-config/${module}`)) {
    throw new Error(`LSP schema-config facade must re-export ${module}.`);
  }
}

const types = read(`${moduleRoot}/types.ts`);
const collections = read(`${moduleRoot}/collections.ts`);
const signature = read(`${moduleRoot}/signature.ts`);
const selection = read(`${moduleRoot}/selection.ts`);
for (const source of [types, collections, signature, selection]) {
  if (source.includes("schemaConfig\"")) {
    throw new Error("LSP schema-config owners cannot import their compatibility facade.");
  }
}
if (types.includes("@/services/") || signature.includes("@/services/") || selection.includes("@/services/")) {
  throw new Error("LSP schema contract, signature, and selection must remain transport-free.");
}
if (!collections.includes("collectionToLspTableDefinition") || !collections.includes("classifyLspColumnOwnership")) {
  throw new Error("LSP collection mapping lost its schema ownership.");
}
if (!signature.includes("lspSchemaSignature") || !selection.includes("selectLspTablesForSchema")) {
  throw new Error("LSP schema canonicalization and selection owners are incomplete.");
}

console.log("LSP schema-config boundaries verified: contract, collection mapping, signature, and table selection owners are explicit.");
