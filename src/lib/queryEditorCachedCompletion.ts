/**
 * Compatibility facade for cached SQL completion fallbacks.
 * Implementation owners live under the query-editor feature so UI consumers
 * retain this stable import while statement, relation and projection parsing
 * remain independently testable.
 */
export type {
  CachedSqlJoinTargetContext,
  CachedSqlProjectionSource,
  CachedSqlRelationReference,
} from "@/features/query-editor/model/cached-completion/types";
export { sqlStatementBeforeCursor } from "@/features/query-editor/model/cached-completion/lexical";
export {
  cachedSqlJoinTargetContext,
  cachedSqlRelationForFieldCompletion,
  cachedSqlRelationTargetPrefix,
  cachedSqlRelationsBeforeCursor,
} from "@/features/query-editor/model/cached-completion/relations";
export { cachedSqlProjectionSources } from "@/features/query-editor/model/cached-completion/projections";
