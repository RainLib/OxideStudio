import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  supportsTableWorkspace,
} from "@/lib/databaseDialect";
import {
  classifyAiQuerySafety,
  redisSelectedDatabase,
} from "@/lib/querySafety";
import {
  extractSchemaContextChange,
  metadataRefreshNamespaces,
  queryMayChangeMetadata,
} from "@/lib/sqlAnalysis";
import { databaseService, QueryResult } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";

export async function refreshMetadataAfterQuery(
  connectionId: string,
  schemaContext: string | undefined,
  sql: string,
  results: QueryResult[] | null | undefined,
) {
  const schemaStore = useSchemaStore.getState();
  const connection = useConnectionStore
    .getState()
    .connections.find((item) => item.id === connectionId);
  const driver = connection?.driver || DEFAULT_DATABASE_DRIVER;
  const fallbackCapabilities = defaultDatabaseCapabilities(driver);
  const capabilities = await databaseService
    .getDatabaseCapabilities(driver, connection?.driverPackageVersion)
    .catch(() => fallbackCapabilities);
  const canBrowseTables = supportsTableWorkspace(capabilities);
  const canBrowseCollections =
    capabilities.supportsCollectionBrowsing ||
    capabilities.supportsKeyValueBrowsing;
  const safety = classifyAiQuerySafety(sql, driver);
  const shouldRefreshObjects =
    queryMayChangeMetadata(sql, results) ||
    (capabilities.dataModel !== "relational" && safety !== "read");

  const refreshNamespaceObjects = async (namespace: string | undefined) => {
    if (!namespace) return;

    const tasks: Promise<void>[] = [];
    if (canBrowseTables) {
      tasks.push(schemaStore.loadTables(connectionId, namespace, true));
      if (capabilities.supportsFunctions) {
        tasks.push(schemaStore.loadFunctions(connectionId, namespace, true));
      }
    }
    if (canBrowseCollections) {
      tasks.push(schemaStore.loadCollections(connectionId, namespace, true));
    }
    await Promise.all(tasks);
  };

  const selectedSchema =
    capabilities.dataModel === "keyValue"
      ? redisSelectedDatabase(sql)
      : extractSchemaContextChange(sql);

  if (selectedSchema) {
    await schemaStore.setCurrentSchema(selectedSchema);
    await refreshNamespaceObjects(selectedSchema);
    schemaStore.bumpMetadataVersion();
    return;
  }

  if (!shouldRefreshObjects) return;

  await schemaStore.loadSchemas(connectionId, true);
  const fallbackSchema =
    useSchemaStore.getState().currentSchema || schemaContext || undefined;
  const namespacesToRefresh = metadataRefreshNamespaces(
    sql,
    fallbackSchema,
    driver,
  );
  await Promise.all(namespacesToRefresh.map(refreshNamespaceObjects));
  schemaStore.bumpMetadataVersion();
}
