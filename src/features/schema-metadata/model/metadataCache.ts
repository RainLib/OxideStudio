import {
  CollectionInfo,
  FunctionInfo,
  Resource,
  TableInfo,
} from "@/services/tauri";

export const SCHEMA_CACHE_KIND = "DATABASE_CACHE";

export const TABLE_CACHE_KIND = "TABLE_CACHE";

export const COLLECTION_CACHE_KIND = "COLLECTION_CACHE";

export const REDIS_KEY_COUNT_CACHE_KIND = "REDIS_KEY_COUNT_CACHE";

export const FUNCTION_CACHE_KIND = "FUNCTION_CACHE";

export const REDIS_KEY_PAGE_SIZE = 100;

export const MAX_REDIS_KEYS_IN_MEMORY = 500;

export const resourceMatchesDriver = (
  resource: Resource,
  driver: string | null | undefined,
) => Boolean(driver && resource.metadata?.driver === driver);

export const redisTotalFromResources = (
  resources: Resource[],
  namespace: string | null,
  driver: string | null | undefined,
) => {
  if (driver !== "redis" || !namespace) return null;
  const total = resources.find(
    (resource) =>
      resource.kind === REDIS_KEY_COUNT_CACHE_KIND &&
      resourceMatchesDriver(resource, driver) &&
      resource.name === namespace,
  )?.metadata?.total;
  return typeof total === "number" ? total : null;
};

export const hasCacheMarker = (
  resources: Resource[],
  kind: string,
  driver: string | null | undefined,
) =>
  resources.some(
    (resource) =>
      resource.kind === kind && resourceMatchesDriver(resource, driver),
  );

export const createCacheMarker = (
  connectionId: string,
  parentId: string | undefined,
  kind: string,
  driver: string | null | undefined,
): Resource => ({
  id: `${connectionId}:${driver || "unknown"}:${parentId || "root"}:${kind}`,
  connection_id: connectionId,
  parent_id: parentId,
  kind,
  name: kind,
  metadata: { driver, cached: true },
  last_updated: Date.now(),
});

export const resourcesToTables = (
  resources: Resource[],
  schema: string,
  driver: string | null | undefined,
): TableInfo[] =>
  resources
    .filter(
      (resource) =>
        resource.kind === "TABLE" && resourceMatchesDriver(resource, driver),
    )
    .map((resource) => ({
      name: resource.name,
      schema,
      type: resource.metadata?.type,
      comment: resource.metadata?.comment,
    }));

export const resourcesToCollections = (
  resources: Resource[],
  namespace: string,
  driver: string | null | undefined,
): CollectionInfo[] =>
  resources
    .filter(
      (resource) =>
        resource.kind === "COLLECTION" &&
        resourceMatchesDriver(resource, driver),
    )
    .map((resource) => ({
      name: resource.name,
      namespace:
        typeof resource.metadata?.namespace === "string"
          ? resource.metadata.namespace
          : namespace || null,
      type:
        typeof resource.metadata?.type === "string"
          ? resource.metadata.type
          : null,
      documentCount:
        typeof resource.metadata?.documentCount === "number"
          ? resource.metadata.documentCount
          : null,
    }));

export const resourcesToFunctions = (
  resources: Resource[],
  driver: string | null | undefined,
): FunctionInfo[] =>
  resources
    .filter(
      (resource) =>
        resource.kind === "FUNCTION" && resourceMatchesDriver(resource, driver),
    )
    .map((resource) => ({
      name: resource.name,
      routine_type:
        typeof resource.metadata?.routine_type === "string"
          ? resource.metadata.routine_type
          : null,
      parameters: Array.isArray(resource.metadata?.parameters)
        ? resource.metadata.parameters
        : [],
      return_type:
        typeof resource.metadata?.return_type === "string"
          ? resource.metadata.return_type
          : "",
      description:
        typeof resource.metadata?.description === "string"
          ? resource.metadata.description
          : null,
    }));
