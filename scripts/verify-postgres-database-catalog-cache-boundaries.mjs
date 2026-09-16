import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/services/postgresDatabaseCatalogCache.ts");
const moduleRoot = "src/services/postgres-database-catalog";
const contracts = read(`${moduleRoot}/contracts.ts`);
const identity = read(`${moduleRoot}/identity.ts`);
const runtime = read(`${moduleRoot}/runtime.ts`);
const storage = read(`${moduleRoot}/storage.ts`);
const subscriptions = read(`${moduleRoot}/subscriptions.ts`);
const refresh = read(`${moduleRoot}/refresh.ts`);
const index = read(`${moduleRoot}/index.ts`);

for (const required of [
  "readCachedPostgresDatabaseCatalog",
  "persistPostgresDatabaseCatalog",
  "refreshPostgresDatabaseCatalog",
  "clearPostgresDatabaseCatalog",
  "subscribePostgresDatabaseCatalog",
]) {
  if (!facade.includes(required)) {
    throw new Error(`PostgreSQL catalog facade must retain ${required}.`);
  }
}

for (const source of [
  contracts,
  identity,
  runtime,
  storage,
  subscriptions,
  refresh,
  index,
]) {
  if (source.includes("postgresDatabaseCatalogCache")) {
    throw new Error("PostgreSQL catalog owners cannot import their compatibility facade.");
  }
}
if (
  contracts.includes("schemaService") ||
  contracts.includes("storeService") ||
  runtime.includes("schemaService") ||
  runtime.includes("storeService")
) {
  throw new Error("Catalog contracts and runtime must stay transport free.");
}
if (
  !identity.includes("resolveMetadataConnectionScope") ||
  identity.includes("storeService") ||
  identity.includes("schemaService")
) {
  throw new Error("Catalog identity must own only scope normalization and keys.");
}
if (
  !storage.includes("storeService.getResources") ||
  !storage.includes("storeService.saveResources") ||
  !storage.includes("storeService.deleteResources") ||
  storage.includes("schemaService")
) {
  throw new Error("Catalog storage must own SQLite cache persistence only.");
}
if (
  !subscriptions.includes("subscribePostgresDatabaseCatalogRuntime") ||
  subscriptions.includes("schemaService") ||
  subscriptions.includes("storeService")
) {
  throw new Error("Catalog subscriptions must remain runtime-only broadcasts.");
}
if (
  !refresh.includes("schemaService.getDatabases") ||
  !refresh.includes("persistPostgresDatabaseCatalog") ||
  !refresh.includes("clearPostgresDatabaseCatalogStorage")
) {
  throw new Error("Catalog refresh must own remote discovery and invalidation orchestration.");
}
if (
  !index.includes("./identity") ||
  !index.includes("./refresh") ||
  !index.includes("./storage")
) {
  throw new Error("Catalog index must compose stable public capabilities.");
}

console.log(
  "PostgreSQL catalog cache boundaries verified: contracts, identity, concurrency runtime, storage, subscriptions, and refresh orchestration are explicit.",
);
