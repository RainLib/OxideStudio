import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/services/tauri/schema.service.ts");
const base = "src/services/tauri/schema";
const ownership = {
  catalog: ["getDatabases", "getDatabaseSchemaObjects", "getCollectionsPage"],
  documents: ["getDocumentPage", "previewMongoDocumentClone", "executeElasticsearchIndexClear"],
  relations: ["getGeneratedColumns", "getDatabaseIndexes", "getReferencingForeignKeys"],
  snapshots: ["captureSchemaSnapshot", "executeSchemaMigration", "refreshTables"],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  if (!facade.includes(`export * from "./schema/${module}";`)) {
    throw new Error(`Schema service facade must re-export ${module}.`);
  }
  if (!facade.includes(`...${module},`)) {
    throw new Error(`Schema service facade must compose ${module}.`);
  }
  if (!source.includes('from "../client"')) {
    throw new Error(`Schema service ${module} must own its Tauri command calls.`);
  }
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Schema service ${module} must retain ${symbol}.`);
    }
  }
  if (source.includes('schema.service')) {
    throw new Error(`Schema service ${module} must not import its compatibility facade.`);
  }
}
console.log("Schema service boundaries verified: facade and four metadata capability owners are explicit.");
