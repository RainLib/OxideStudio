import type {
  PostgresDatabaseCatalogIdentity,
  PostgresDatabaseCatalogListener,
  PostgresDatabaseCatalogSnapshot,
} from "./contracts";
import { postgresDatabaseCatalogKey } from "./identity";
import {
  notifyPostgresDatabaseCatalogRuntime,
  subscribePostgresDatabaseCatalogRuntime,
} from "./runtime";

export function subscribePostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
  listener: PostgresDatabaseCatalogListener,
) {
  return subscribePostgresDatabaseCatalogRuntime(
    postgresDatabaseCatalogKey(identity),
    listener,
  );
}

export function notifyPostgresDatabaseCatalog(
  identity: PostgresDatabaseCatalogIdentity,
  snapshot: PostgresDatabaseCatalogSnapshot,
) {
  notifyPostgresDatabaseCatalogRuntime(
    postgresDatabaseCatalogKey(identity),
    snapshot,
  );
}
