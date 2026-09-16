import { createDatabaseDriverCatalog } from "./createDatabaseDriverCatalog";

// One catalog shared by all existing public entry points.
export const {
  registerDatabaseCapabilities,
  registerRuntimeDatabaseCatalog,
  syncExternalDatabaseDriverProfiles,
  resetRuntimeDatabaseCatalogForTests,
  registerDatabaseDriverProfile,
  databaseDriverProfile,
  supportedDatabaseDriverProfiles,
  supportedDatabaseDrivers,
  normalizeDatabaseDriverName,
} = createDatabaseDriverCatalog();
