export {
  connectionUrlScheme,
  connectionUrlTemplateForDriver,
  defaultConnectionAccentClassName,
  defaultConnectionIcon,
  defaultDatabaseCapabilities,
  defaultDatabaseName,
  defaultDatabasePort,
  isFileBasedDatabaseDriver,
  sslModeParamAliases,
  sslModeParamName,
} from "@/features/database-drivers/model/connectionDefaults";
export {
  defaultLengthForDataType,
  defaultStringDataType,
  supportsAutoIncrementForDataType,
} from "@/features/database-drivers/model/dataTypePolicy";
export { DEFAULT_DATABASE_DRIVER } from "@/features/database-drivers/model/driverIdentity";
export type { DatabaseDriverProfile } from "@/features/database-drivers/model/driverProfileTypes";
export {
  configuredLspLanguageId,
  configuredLspLanguageIdForCapabilities,
  lspLanguageId,
  lspLanguageIdForCapabilities,
  lspServerDialectForCapabilities,
  normalizeLspDialect,
  queryEditorLanguageId,
  queryEditorLanguageIdForCapabilities,
  supportsLspCapabilities,
  supportsLspLanguageId,
} from "@/features/database-drivers/model/lspRouting";
export {
  connectionDatabaseNamespacePreference,
  isSystemNamespace,
  pluralizeNamespaceLabel,
  selectPreferredNamespace,
} from "@/features/database-drivers/model/namespaceSelection";
export {
  canAlterRelationStructure,
  canManageRelationIndexes,
  isForeignTableObject,
  isMaterializedViewObject,
  isReadOnlyRelationObject,
  isViewObject,
  normalizeRelationObjectType,
  relationObjectLabel,
} from "@/features/database-drivers/model/relationObjectTypes";
export {
  databaseDriverProfile,
  normalizeDatabaseDriverName,
  registerDatabaseCapabilities,
  registerDatabaseDriverProfile,
  registerRuntimeDatabaseCatalog,
  resetRuntimeDatabaseCatalogForTests,
  supportedDatabaseDriverProfiles,
  supportedDatabaseDrivers,
  syncExternalDatabaseDriverProfiles,
} from "@/features/database-drivers/model/runtimeCatalog";
export {
  formatSqlValue,
  previewTableQuery,
  qualifiedTableName,
  quoteIdentifier,
  quoteIdentifierWithCapabilities,
} from "@/features/database-drivers/model/sqlIdentifiers";
export {
  isRelationalDataModel,
  supportsSqlRelationMetadataLsp,
  supportsSqlWorkspace,
  supportsTableWorkspace,
} from "@/features/database-drivers/model/workspaceCapabilities";
