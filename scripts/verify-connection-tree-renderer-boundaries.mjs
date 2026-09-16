import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/features/database-explorer/ui/createConnectionTreeRenderer.tsx");
const contract = read("src/features/database-explorer/ui/connection-tree/types.ts");
const row = read("src/features/database-explorer/ui/connection-tree/ConnectionTreeRow.tsx");

for (const required of [
  "createConnectionTreeRowRenderer",
  "CreateConnectionTreeRendererContext",
  "export function createConnectionTreeRenderer",
]) {
  if (!facade.includes(required)) throw new Error(`Connection tree facade must retain ${required}.`);
}
for (const required of [
  "export interface CreateConnectionTreeRendererContext",
  "connectionVirtualWindow",
  "schemaObjectsFor",
  "renderSchemaObjects",
  "handleConnectionToggle",
]) {
  if (!contract.includes(required)) throw new Error(`Connection tree contract must retain ${required}.`);
}
for (const required of [
  "export function createConnectionTreeRowRenderer",
  "const renderConnection =",
  "ExplorerConnectionGroupRow",
  "ExplorerConnectionMenu",
  "ExplorerConnectionContents",
  "readExplorerDraggedConnectionIds",
]) {
  if (!row.includes(required)) throw new Error(`Connection tree row owner must retain ${required}.`);
}
if (row.includes('createConnectionTreeRenderer"')) {
  throw new Error("Connection tree row owner must not import its compatibility facade.");
}
console.log("Connection tree renderer boundaries verified: contract, facade, and row renderer are explicit.");
