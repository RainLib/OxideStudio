import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/features/database-search/DatabaseSearchDialog.tsx");
const controller = read("src/features/database-search/hooks/useDatabaseSearchDialogController.ts");
const view = read("src/features/database-search/ui/DatabaseSearchDialogView.tsx");
const contract = read("src/features/database-search/model/databaseSearchDialog.ts");

for (const required of [
  "useDatabaseSearchDialogController",
  "DatabaseSearchDialogView",
  "export function DatabaseSearchDialog",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Database search facade must retain ${required}.`);
  }
}

for (const required of [
  "export function useDatabaseSearchDialogController",
  "getConnectionDatabaseCapabilityContext(",
  "executeDatabaseSearch(",
  "buildSearchResultWheres(",
  "cancelQuery(",
  "findOrCreateTableTab(",
  "runPlanBatch",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Database search controller must retain ${required}.`);
  }
}

for (const required of [
  "DatabaseSearchDialogProps",
  "databaseSearchRelationLabel",
  "boundedDatabaseSearchError",
]) {
  if (!contract.includes(required)) {
    throw new Error(`Database search dialog contract must retain ${required}.`);
  }
}

for (const forbidden of [
  "useState(",
  "useEffect(",
  "databaseSearchService",
  "databaseService",
  "schemaService",
  "queryService",
  "useConnectionStore(",
  "useSchemaStore(",
  "useTabStore(",
]) {
  if (view.includes(forbidden)) {
    throw new Error(`Database search view must not own ${forbidden}.`);
  }
}

if (view.includes('features/database-search/DatabaseSearchDialog')) {
  throw new Error("Database search view must not import its compatibility facade.");
}

console.log("Database search dialog boundaries verified: facade, search lifecycle controller, contract, and presentation are explicit.");
