import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readSourceText(path.join(root, relativePath));
const facadePath = "src/services/documentMetadataCache.ts";
const base = "src/services/document-metadata-cache";
const facade = read(facadePath);

for (const required of [
  'export { DocumentMetadataCache } from "./document-metadata-cache/cache";',
  'export {\n  documentMetadataCacheKey,\n  documentMetadataCacheScope,\n} from "./document-metadata-cache/identity";',
  'export { knownDocumentCollectionNamesForScope } from "./document-metadata-cache/collections";',
  'export {\n  invalidateDocumentMetadataScope,\n  loadDocumentMetadata,\n  resetDocumentMetadataCacheForTests,\n} from "./document-metadata-cache/runtime";',
]) {
  if (!facade.includes(required)) {
    throw new Error(`Document metadata cache facade must retain ${required}.`);
  }
}

const ownership = {
  contracts: ["DocumentMetadataCacheIdentity", "KnownDocumentCollection"],
  cache: ["export class DocumentMetadataCache", "refresh(", "prune("],
  identity: ["documentMetadataCacheScope", "documentMetadataCacheKey"],
  collections: ["knownDocumentCollectionNamesForScope"],
  runtime: ["loadDocumentMetadata", "invalidateDocumentMetadataScope"],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Document metadata ${module} owner must retain ${symbol}.`);
    }
  }
}

for (const module of ["contracts", "identity", "collections"]) {
  if (read(`${base}/${module}.ts`).includes('from "./cache"')) {
    throw new Error(`Document metadata ${module} must remain cache-runtime independent.`);
  }
}
if (read(`${base}/cache.ts`).includes("documentMetadataCacheScope")) {
  throw new Error("Document metadata cache mechanics must remain identity independent.");
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; document metadata owners must not depend on the compatibility facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Document metadata cache");
console.log(
  `Document metadata cache boundaries verified: stable facade, ${graph.size} cache and identity modules, and acyclic refresh ownership are explicit.`,
);
