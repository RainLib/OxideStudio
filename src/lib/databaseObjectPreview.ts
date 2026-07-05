import type { CollectionInfo, DatabaseDriver } from "@/services/tauri/types";

export function collectionObjectLabel(driver: DatabaseDriver) {
  const normalized = String(driver).toLowerCase();
  if (normalized === "elasticsearch" || normalized === "elastic") return "Index";
  if (normalized === "redis") return "Key";
  return "Collection";
}

export function collectionObjectPluralLabel(driver: DatabaseDriver) {
  const label = collectionObjectLabel(driver);
  return label === "Index" ? "Indices" : `${label}s`;
}

export function collectionPreviewTabTitle(
  driver: DatabaseDriver,
  collection: Pick<CollectionInfo, "name" | "type">
) {
  const label = collectionObjectLabel(driver);
  const suffix = collection.type ? `:${collection.type}` : "";
  return `${label}: ${collection.name}${suffix}`;
}

export function collectionPreviewQueryTemplate(
  driver: DatabaseDriver,
  namespace: string | null,
  collection: CollectionInfo
) {
  const normalized = String(driver).toLowerCase();
  if (normalized === "elasticsearch" || normalized === "elastic") {
    return `GET /${encodeURIComponent(collection.name)}/_search\n${JSON.stringify(
      {
        query: { match_all: {} },
        size: 100,
      },
      null,
      2
    )}`;
  }

  if (normalized === "redis") {
    return redisPreviewCommand(collection.name, collection.type);
  }

  return JSON.stringify(
    {
      ...(namespace ? { database: namespace } : {}),
      collection: collection.name,
      find: {},
      limit: 100,
    },
    null,
    2
  );
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
