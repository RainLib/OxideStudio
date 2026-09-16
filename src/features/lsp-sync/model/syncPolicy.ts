export const LSP_METADATA_CACHE_TTL_MS = 60_000;

export const LSP_PROGRESS_PUBLISH_INTERVAL_MS = 1_000;

export const LSP_PROGRESS_PUBLISH_BATCHES = 8;

export const LSP_TAB_SNAPSHOT_DEBOUNCE_MS = 160;

export const EXACT_GENERATED_COLUMN_METADATA_DRIVERS = new Set([
  "postgres",
  "mysql",
  "sqlite",
]);
