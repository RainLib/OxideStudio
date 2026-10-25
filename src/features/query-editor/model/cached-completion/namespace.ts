import { splitQualifiedIdentifier } from "./lexical";
import type { CachedSqlRelationReference } from "./types";

/** The current metadata transport accepts connection/catalog/schema/table.
 * A linked server or unresolved default schema is a different identity. */
export function cachedPhysicalNamespaceSupported(relation: Pick<CachedSqlRelationReference, "server" | "schemaOmitted">) {
  return !relation.server && !relation.schemaOmitted;
}
export function cachedCatalogNamespaceMatches(fragment: string, scope: {
  databaseName?: string | null;
  schema?: string | null;
}) {
  const value = fragment.trim();
  const target = splitQualifiedIdentifier(value.endsWith('.') ? value + '__oxide_target' : value);
  if (!target) return !value;
  if (!cachedPhysicalNamespaceSupported(target)) return false;
  if (target.schema && target.schema !== scope.schema) return false;
  if ('database' in target && target.database && target.database !== scope.databaseName) return false;
  return true;
}
