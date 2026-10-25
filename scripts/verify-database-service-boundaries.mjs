import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/services/tauri/database.service.ts");
const owners = {
  capabilities: ["getDatabaseCapabilities", "activateExternalDatabaseDriver", "resetDatabaseCapabilityCachesForTests"],
  administration: ["listDatabaseAdminSessions", "executeSqliteBackupPlan", "createDatabase"],
};
for (const [module, symbols] of Object.entries(owners)) {
  const source = read(`src/services/tauri/database/${module}.ts`);
  if (!facade.includes(`export * from "./database/${module}";`) || !facade.includes(`...${module},`)) {
    throw new Error(`Database service facade must compose ${module}.`);
  }
  if (!source.includes('from "../client"') || source.includes('database.service')) {
    throw new Error(`Database service ${module} must own commands without loading its facade.`);
  }
  if (symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`Database service ${module} lost a capability owner.`);
  }
}
console.log("Database service boundaries verified: capability lifecycle and administration owners are explicit.");
