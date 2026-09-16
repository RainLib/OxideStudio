// Compatibility entry. Language implementations import their domain modules directly.
export { maskSqlNoise } from "@/features/query-languages/sql/maskNoise";
export {
  metadataRefreshNamespaces,
  queryMayChangeMetadata,
} from "@/features/query-languages/sql/metadataEffects";
export {
  normalizeSqlPlaceholders,
  sqlPlaceholderSpans,
} from "@/features/query-languages/sql/placeholders";
export type {
  SqlPlaceholderKind,
  SqlPlaceholderSpan,
} from "@/features/query-languages/sql/placeholders";
export { extractRelationReferences } from "@/features/query-languages/sql/relations";
export type { RelationReference } from "@/features/query-languages/sql/relations";
export { extractSchemaContextChange } from "@/features/query-languages/sql/schemaContext";
export {
  firstSqlKeyword,
  splitSqlStatements,
  stripLeadingSqlComments,
} from "@/features/query-languages/sql/statements";
