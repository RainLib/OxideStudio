import { extractRelationReferences } from "@/features/query-languages/sql/relations";
import {
  firstSqlKeyword,
  splitSqlStatements,
} from "@/features/query-languages/sql/statements";
import type { QueryResult } from "@/services/tauri/types";

const METADATA_STATEMENT_TYPES = new Set([
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "COMMENT",
  "RENAME",
]);

export function queryMayChangeMetadata(
  sql: string,
  results: Pick<QueryResult, "statementType">[] | null | undefined,
) {
  if (
    results?.some((result) =>
      METADATA_STATEMENT_TYPES.has((result.statementType || "").toUpperCase()),
    )
  ) {
    return true;
  }

  return splitSqlStatements(sql).some((statement) => {
    const keyword = firstSqlKeyword(statement);
    return !!keyword && METADATA_STATEMENT_TYPES.has(keyword);
  });
}

export function metadataRefreshNamespaces(
  sql: string,
  fallbackNamespace?: string | null,
  dialect?: string | null,
) {
  const namespaces = new Set<string>();

  for (const reference of extractRelationReferences(sql, dialect)) {
    if (reference.schema) {
      namespaces.add(reference.schema);
    }
  }

  const fallback = fallbackNamespace?.trim();
  if (namespaces.size === 0 && fallback) {
    namespaces.add(fallback);
  }

  return Array.from(namespaces);
}
