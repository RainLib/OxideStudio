/**
 * Preserve a conservative metadata fallback when a live language service is
 * available but has no proposal for the current revision. The caller owns the
 * safety policy for cached values; this helper only makes the async ordering
 * explicit and keeps editor integration testable without Monaco.
 */
export async function completionSuggestionsOrCached<TLive, TCached>(
  liveSuggestions: readonly TLive[],
  cachedSuggestions: () => Promise<TCached[]>,
): Promise<Array<TLive | TCached>> {
  return liveSuggestions.length > 0
    ? [...liveSuggestions]
    : cachedSuggestions();
}

/**
 * Cached metadata and grammar fallbacks answer different questions: the
 * former supplies only scoped relation fields, while the latter supplies SQL
 * operators and clause keywords. Keep both at the same cursor position, but
 * never duplicate a label when a provider already supplied it.
 */
export function mergeCompletionFallbackSuggestions<T extends { label: string }>(
  primary: readonly T[],
  secondary: readonly T[],
): T[] {
  const labels = new Set<string>();
  const result: T[] = [];
  for (const suggestion of [...primary, ...secondary]) {
    const key = suggestion.label.trim().toLocaleLowerCase();
    if (!key || labels.has(key)) continue;
    labels.add(key);
    result.push(suggestion);
  }
  return result;
}
