import type { cachedSqlFieldBindings } from "./relations";
import type { CachedColumnSet, CachedSearchColumn } from "./metadataSearch";
import type { CachedSqlRelationReference } from "./types";
import { cachedColumnMatches } from "./columnIdentity";
export const MAX_UNQUALIFIED_CACHED_INPUTS = 16;

/** Resolve SQL name lookup by query block, not by catalog order. An unreadable
 * input may contain the same name, so it cannot prove a match is unique. */
export async function uniqueCachedColumn(view: ReturnType<typeof cachedSqlFieldBindings>, sql: string, driver: string, read: (relation: CachedSqlRelationReference) => Promise<CachedColumnSet>, token: {
  isCancellationRequested?: boolean;
}, onIncomplete: () => void): Promise<CachedSearchColumn | undefined> {
  if (!view.inputsComplete) return undefined;
  const tiers = [...new Set(view.owners.values())].sort((a, b) => b - a);
  for (const owner of tiers) {
    const inputs = view.relations.filter(relation => view.owners.get(relation) === owner);
    if (inputs.length > MAX_UNQUALIFIED_CACHED_INPUTS) {
      onIncomplete();
      return undefined;
    }
    // Explicit unresolved namespaces cannot be routed by the local transport.
    if (inputs.some(input => input.server || input.schemaOmitted || input.localSource?.kind === "physical" && (input.localSource.server || input.localSource.schemaOmitted))) return undefined;
    const aliases = new Set<string>();
    for (const input of inputs) {
      if (!input.alias) continue;
      const key = input.alias.toLowerCase();
      if (aliases.has(key)) return undefined;
      aliases.add(key);
    }
    const matches: CachedSearchColumn[] = [];
    for (const input of inputs) {
      if (token.isCancellationRequested) return undefined;
      const fields = await read(input);
      if (token.isCancellationRequested || !fields.complete) return undefined;
      matches.push(...fields.columns.filter(column => cachedColumnMatches(column.name, sql, driver)));
    }
    // A nearest-block ambiguity must never fall through to a parent match.
    if (matches.length) return matches.length === 1 ? matches[0] : undefined;
  }
  return undefined;
}
