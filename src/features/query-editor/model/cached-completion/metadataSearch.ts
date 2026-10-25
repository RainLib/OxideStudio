import { completionMatchScore, containsHan, ensurePinyinCompletionSupport } from "../completionMatch";
export type CachedSearchColumn = {
  name: string;
  dataType: string;
  comment?: string | null;
};
export type CachedColumnSet = {
  columns: CachedSearchColumn[];
  complete: boolean;
};
export const MAX_CACHED_FIELD_COMPLETIONS = 256;
const encoder = new TextEncoder();

/** Bound auxiliary metadata by UTF-8 bytes without splitting a code point. */
export function boundedCachedComment(value: string | undefined | null, maximum = 2048) {
  if (!value) return "";
  if (value.length * 3 <= maximum) return value;
  let bytes = 0,
    end = 0;
  for (const character of value) {
    const cp = character.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes > maximum) break;
    end += character.length;
  }
  return value.slice(0, end);
}
type SearchableColumn = Pick<CachedSearchColumn, "name" | "comment">;
function prepareEntries<T extends SearchableColumn>(columns: readonly T[], query: string) {
  const auxiliary = encoder.encode(query).length <= 128;
  return columns.map((column, index) => ({ column, index, comment: auxiliary ? boundedCachedComment(column.comment) : "" }));
}

function emptyColumnSearch<T extends SearchableColumn>(columns: readonly T[]) {
  return {
    items: columns.slice(0, MAX_CACHED_FIELD_COMPLETIONS).map((column, index) => ({
      column,
      index,
      score: 0,
      commentOnly: false,
      sortText: `0:${String(index).padStart(4, "0")}:${column.name.toLocaleLowerCase()}`,
      filterText: undefined as string | undefined
    })),
    incomplete: columns.length > MAX_CACHED_FIELD_COMPLETIONS
  };
}

function rankEntries<T extends SearchableColumn>(entries: ReturnType<typeof prepareEntries<T>>, query: string) {
  const matches = entries.flatMap(({
    column,
    index,
    comment
  }) => {
    const nameScore = completionMatchScore(column.name, query);
    const commentScore = query && comment ? completionMatchScore(comment, query) : -1;
    if (nameScore < 0 && commentScore < 0) return [];
    return [{
      column,
      index,
      score: nameScore >= 0 ? nameScore : commentScore,
      commentOnly: nameScore < 0
    }];
  });
  matches.sort((a, b) => Number(a.commentOnly) - Number(b.commentOnly) || b.score - a.score || a.index - b.index);
  return {
    items: matches.slice(0, MAX_CACHED_FIELD_COMPLETIONS).map((match, index) => ({
      ...match,
      sortText: `0:${String(index).padStart(4, "0")}:${match.column.name.toLocaleLowerCase()}`,
      filterText: query || undefined
    })),
    incomplete: matches.length > MAX_CACHED_FIELD_COMPLETIONS
  };
}

/** The synchronous path shares ordering and bounds with asynchronous providers. */
export function rankCachedColumns<T extends SearchableColumn>(columns: readonly T[], query: string) {
  if(!query)return emptyColumnSearch(columns);
  return rankEntries(prepareEntries(columns, query), query);
}

export async function searchCachedColumns<T extends SearchableColumn>(columns: readonly T[], query: string, token: {
  readonly isCancellationRequested?: boolean;
}) {
  const empty = () => ({ items: [] as ReturnType<typeof rankCachedColumns<T>>["items"], incomplete: false });
  if (token.isCancellationRequested) return empty();
  if(!query)return emptyColumnSearch(columns);
  const entries = prepareEntries(columns, query);
  if (/^[a-z0-9]+$/iu.test(query) && entries.some(({column, comment}) => containsHan(column.name) || containsHan(comment))) await ensurePinyinCompletionSupport();
  if (token.isCancellationRequested) return empty();
  return rankEntries(entries, query);
}
