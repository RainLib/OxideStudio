import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readSourceText(path.join(root, file));
const facade = read("src/services/tableMetadataCache.ts");

for (const symbol of [
  "tableMetadataParentId",
  "loadTableMetadata",
  "loadTableDdl",
  "loadViewDefinition",
  "invalidateTableMetadata",
]) {
  if (!facade.includes(symbol)) {
    throw new Error(`Table metadata cache facade lost ${symbol}.`);
  }
}

const identity = read("src/services/table-metadata-cache/identity.ts");
const runtime = read("src/services/table-metadata-cache/runtime.ts");
const storage = read("src/services/table-metadata-cache/storage.ts");
const metadata = read("src/services/table-metadata-cache/metadata.ts");
const sources = read("src/services/table-metadata-cache/objectSources.ts");
const implementations = [identity, runtime, storage, metadata, sources];

if (implementations.some((source) => source.includes("tableMetadataCache\""))) {
  throw new Error("Table metadata cache owners cannot import the compatibility facade.");
}
if (identity.includes("@/services/tauri") || runtime.includes("@/services/tauri")) {
  throw new Error("Table metadata identity and runtime owners must remain transport-free.");
}
if (!storage.includes("storeService") || storage.includes("schemaService") || storage.includes("tableService")) {
  throw new Error("Table metadata storage must own persistence only.");
}
if (!metadata.includes("schemaService") || metadata.includes("tableService")) {
  throw new Error("Table metadata loader must own schema metadata requests only.");
}
if (!sources.includes("tableService") || sources.includes("schemaService")) {
  throw new Error("Table object-source loader must own DDL and view requests only.");
}

console.log("Table metadata cache boundaries verified: identity, runtime, storage, metadata, and object-source owners are explicit.");
