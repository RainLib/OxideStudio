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
export function mergeCompletionFallbackSuggestions<
  TPrimary extends { label: string; detail?: unknown },
  TSecondary extends { label: string; detail?: unknown },
>(
  primary: readonly TPrimary[],
  secondary: readonly TSecondary[],
): Array<TPrimary | TSecondary> {
  const identities = new Set<string>();
  const primaryLabels = new Set<string>();
  const result: Array<TPrimary | TSecondary> = [];
  const append = (suggestion: TPrimary | TSecondary, isPrimary: boolean) => {
    const label = suggestion.label.trim().toLocaleLowerCase();
    if (!label || (!isPrimary && primaryLabels.has(label))) return;
    const detail =
      typeof suggestion.detail === "string"
        ? suggestion.detail.trim().toLocaleLowerCase()
        : "";
    // Language servers commonly return one CompletionItem per overload. Keep
    // those signature rows distinct, while a primary semantic result still
    // suppresses a same-label grammar/cache fallback.
    const identity = detail ? `${label}\u0000${detail}` : label;
    if (identities.has(identity)) return;
    identities.add(identity);
    if (isPrimary) primaryLabels.add(label);
    result.push(suggestion);
  };
  primary.forEach((suggestion) => append(suggestion, true));
  secondary.forEach((suggestion) => append(suggestion, false));
  return result;
}
