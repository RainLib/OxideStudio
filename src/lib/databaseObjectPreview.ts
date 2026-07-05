import type {
  CollectionInfo,
  DatabaseCapabilities,
  DatabaseDataModel,
  DatabaseDriver,
} from "@/services/tauri/types";
import { defaultDatabaseCapabilities } from "./databaseDialect";

export type DatabaseObjectPreviewContext = {
  capabilities: DatabaseCapabilities;
  namespace: string | null;
  collection: CollectionInfo;
};

export type DatabaseObjectPreviewProvider = {
  id: string;
  priority?: number;
  matches: (capabilities: DatabaseCapabilities) => boolean;
  objectLabel: string;
  objectPluralLabel?: string;
  tabTitle?: (context: DatabaseObjectPreviewContext) => string;
  queryTemplate: (context: DatabaseObjectPreviewContext) => string;
  deleteQueryTemplate?: (context: DatabaseObjectPreviewContext) => string | null;
};

const registeredPreviewProviders: DatabaseObjectPreviewProvider[] = [];

export function registerDatabaseObjectPreviewProvider(
  provider: DatabaseObjectPreviewProvider
) {
  const existingIndex = registeredPreviewProviders.findIndex(
    (candidate) => candidate.id === provider.id
  );
  if (existingIndex >= 0) {
    registeredPreviewProviders.splice(existingIndex, 1, provider);
  } else {
    registeredPreviewProviders.push(provider);
  }
  sortPreviewProviders();
}

export function databaseObjectPreviewProvider(
  capabilities: DatabaseCapabilities
) {
  return (
    [...registeredPreviewProviders, ...BUILTIN_PREVIEW_PROVIDERS]
      .sort(comparePreviewProviders)
      .find((provider) => provider.matches(capabilities)) ??
    fallbackPreviewProvider
  );
}

export function collectionObjectLabel(driver: DatabaseDriver) {
  return databaseObjectPreviewProvider(
    defaultDatabaseCapabilities(driver)
  ).objectLabel;
}

export function collectionObjectPluralLabel(driver: DatabaseDriver) {
  const provider = databaseObjectPreviewProvider(defaultDatabaseCapabilities(driver));
  return provider.objectPluralLabel || `${provider.objectLabel}s`;
}

export function collectionPreviewTabTitle(
  driver: DatabaseDriver,
  collection: Pick<CollectionInfo, "name" | "type">
) {
  const capabilities = defaultDatabaseCapabilities(driver);
  return collectionPreviewTabTitleForCapabilities(capabilities, {
    ...collection,
    namespace: null,
    documentCount: null,
  });
}

export function collectionPreviewTabTitleForCapabilities(
  capabilities: DatabaseCapabilities,
  collection: CollectionInfo,
  namespace: string | null = null
) {
  const provider = databaseObjectPreviewProvider(capabilities);
  return provider.tabTitle?.({ capabilities, namespace, collection }) ??
    defaultPreviewTabTitle(provider.objectLabel, collection);
}

export function collectionPreviewQueryTemplate(
  driver: DatabaseDriver,
  namespace: string | null,
  collection: CollectionInfo
) {
  return collectionPreviewQueryTemplateForCapabilities(
    defaultDatabaseCapabilities(driver),
    namespace,
    collection
  );
}

export function collectionPreviewQueryTemplateForCapabilities(
  capabilities: DatabaseCapabilities,
  namespace: string | null,
  collection: CollectionInfo
) {
  return databaseObjectPreviewProvider(capabilities).queryTemplate({
    capabilities,
    namespace,
    collection,
  });
}

export function collectionDeleteQueryTemplateForCapabilities(
  capabilities: DatabaseCapabilities,
  namespace: string | null,
  collection: CollectionInfo
) {
  const provider = databaseObjectPreviewProvider(capabilities);
  return provider.deleteQueryTemplate?.({
    capabilities,
    namespace,
    collection,
  }) ?? null;
}

const BUILTIN_PREVIEW_PROVIDERS: DatabaseObjectPreviewProvider[] = [
  {
    id: "builtin.key-value",
    priority: 300,
    matches: dataModelMatches("keyValue"),
    objectLabel: "Key",
    queryTemplate: ({ collection }) =>
      redisPreviewCommand(collection.name, collection.type),
    deleteQueryTemplate: ({ collection }) => `DEL ${JSON.stringify(collection.name)}`,
  },
  {
    id: "builtin.search.elasticsearch",
    priority: 250,
    matches: dataModelMatches("search"),
    objectLabel: "Index",
    objectPluralLabel: "Indices",
    queryTemplate: ({ collection }) =>
      `GET /${encodeURIComponent(collection.name)}/_search\n${JSON.stringify(
        {
          query: { match_all: {} },
          size: 100,
        },
        null,
        2
      )}`,
    deleteQueryTemplate: ({ collection }) =>
      `DELETE /${encodeURIComponent(collection.name)}`,
  },
  {
    id: "builtin.document",
    priority: 200,
    matches: dataModelMatches("document"),
    objectLabel: "Collection",
    queryTemplate: ({ namespace, collection }) =>
      JSON.stringify(
        {
          ...(namespace ? { database: namespace } : {}),
          collection: collection.name,
          find: {},
          limit: 100,
        },
        null,
        2
      ),
    deleteQueryTemplate: ({ namespace, collection }) =>
      JSON.stringify(
        {
          ...(namespace ? { database: namespace } : {}),
          command: { drop: collection.name },
        },
        null,
        2
      ),
  },
];

const fallbackPreviewProvider: DatabaseObjectPreviewProvider = {
  id: "builtin.fallback",
  priority: -1,
  matches: () => true,
  objectLabel: "Object",
  queryTemplate: ({ collection }) => collection.name,
};

function dataModelMatches(dataModel: DatabaseDataModel) {
  return (capabilities: DatabaseCapabilities) =>
    capabilities.dataModel === dataModel;
}

function defaultPreviewTabTitle(
  label: string,
  collection: Pick<CollectionInfo, "name" | "type">
) {
  const suffix = collection.type ? `:${collection.type}` : "";
  return `${label}: ${collection.name}${suffix}`;
}

function sortPreviewProviders() {
  registeredPreviewProviders.sort(comparePreviewProviders);
}

function comparePreviewProviders(
  left: DatabaseObjectPreviewProvider,
  right: DatabaseObjectPreviewProvider
) {
  return (right.priority ?? 0) - (left.priority ?? 0);
}

function redisPreviewCommand(keyName: string, keyType?: string | null) {
  const key = JSON.stringify(keyName);
  switch ((keyType || "").toLowerCase()) {
    case "string":
      return `GET ${key}`;
    case "hash":
      return `HGETALL ${key}`;
    case "list":
      return `LRANGE ${key} 0 99`;
    case "set":
      return `SMEMBERS ${key}`;
    case "zset":
      return `ZRANGE ${key} 0 99 WITHSCORES`;
    case "stream":
      return `XRANGE ${key} - + COUNT 100`;
    default:
      return `TYPE ${key}`;
  }
}
