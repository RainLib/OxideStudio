import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/features/database-drivers/settings/DriverManagementSettings.tsx");
const controller = read("src/features/database-drivers/settings/useDriverManagement.ts");
const sections = [
  "DriverInstallationsSection",
  "DriverRuntimeHealthSection",
  "DriverReferenceCoverageSection",
  "ManagedJavaRuntimesSection",
  "RemoteSqliteWorkerSection",
  "SignedDriverCatalogSection",
].map((name) => ({
  name,
  source: read(`src/features/database-drivers/settings/ui/${name}.tsx`),
}));

for (const required of ["useDriverManagement", "SettingsPanel", ...sections.map(({ name }) => name)]) {
  if (!facade.includes(required)) {
    throw new Error(`Driver settings facade must retain ${required}.`);
  }
}
for (const required of [
  "export function useDriverManagement",
  "listDatabaseDriverInstallations()",
  "listExternalDatabaseDriverRuntimes",
  "installExternalDatabaseDriverFromCatalog(",
  "reconnectExternalDatabaseDriverRuntimes",
  "setInterval",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Driver settings controller must retain ${required}.`);
  }
}
for (const { name, source } of sections) {
  if (!source.includes(`export function ${name}`)) {
    throw new Error(`Driver settings must retain ${name}.`);
  }
  for (const forbidden of ["useDriverManagement(", "useState(", "useEffect(", "databaseService"]) {
    if (source.includes(forbidden)) {
      throw new Error(`${name} must not own ${forbidden}.`);
    }
  }
}
console.log("Driver management settings boundaries verified: one lifecycle controller and focused presentation sections are explicit.");
