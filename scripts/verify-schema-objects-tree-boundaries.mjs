import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/features/database-explorer/ui/SchemaObjectsTree.tsx");
const contract = read("src/features/database-explorer/ui/schema-objects-tree/types.ts");
const view = read("src/features/database-explorer/ui/schema-objects-tree/SchemaObjectsTreeView.tsx");

for (const required of [
  "SchemaObjectsTreeContext",
  "SchemaObjectsTreeView",
  "export function SchemaObjectsTree",
]) {
  if (!facade.includes(required)) throw new Error(`Schema objects facade must retain ${required}.`);
}
for (const required of [
  "export interface SchemaObjectsTreeContext",
  "refreshSelectedTableMetadata",
  "renderRedisKeyNodes",
  "renderTableItem",
  "renderSchemaObjectDescriptors",
]) {
  if (!contract.includes(required)) throw new Error(`Schema objects contract must retain ${required}.`);
}
for (const required of [
  "export function SchemaObjectsTreeView",
  "ExplorerSegmentedVirtualList",
  "toggleAllVisibleTableBatchSelection",
  "buildRedisKeyTree",
  "handleOpenDataTransfer",
  "handleOpenDataCompare",
]) {
  if (!view.includes(required)) throw new Error(`Schema objects view owner must retain ${required}.`);
}
if (view.includes('SchemaObjectsTree"')) {
  throw new Error("Schema objects view owner must not import its compatibility facade.");
}
console.log("Schema objects tree boundaries verified: facade, contract, and object-tree view are explicit.");
