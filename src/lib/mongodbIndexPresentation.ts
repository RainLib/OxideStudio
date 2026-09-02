import type { IndexInfo } from "@/services/tauri/types";

export type MongoDbIndexPresentation = {
  expireAfterSeconds: number | null;
  isHidden: boolean;
  isSparse: boolean;
  hasPartialFilter: boolean;
};

const EMPTY_PRESENTATION: MongoDbIndexPresentation = {
  expireAfterSeconds: null,
  isHidden: false,
  isSparse: false,
  hasPartialFilter: false,
};

/**
 * MongoDB has index semantics (TTL, hidden, sparse and partial) that the
 * cross-driver IndexInfo contract intentionally keeps inside `definition`.
 * Decode only safe display hints here; malformed or legacy definitions remain
 * ordinary generic indexes.
 */
export function mongodbIndexPresentation(
  index: Pick<IndexInfo, "definition">,
): MongoDbIndexPresentation {
  if (!index.definition) return EMPTY_PRESENTATION;
  try {
    const value: unknown = JSON.parse(index.definition);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return EMPTY_PRESENTATION;
    }
    const record = value as Record<string, unknown>;
    const ttl = record.expireAfterSeconds;
    return {
      expireAfterSeconds:
        typeof ttl === "number" && Number.isFinite(ttl) && ttl >= 0
          ? ttl
          : null,
      isHidden: record.hidden === true,
      isSparse: record.sparse === true,
      hasPartialFilter:
        record.partialFilterExpression !== null &&
        typeof record.partialFilterExpression === "object",
    };
  } catch {
    return EMPTY_PRESENTATION;
  }
}
