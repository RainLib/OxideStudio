import type { ProjectFileEntry } from "@/services/tauri/project-files.service";
import type { TableInfo } from "@/services/tauri/types";

export type SearchableDatabaseObject =
  | {
      kind: "schema";
      name: string;
      schema: string;
    }
  | {
      kind: "relation";
      name: string;
      schema: string;
      objectType: string | null;
    };

export function searchableDatabaseObjects(
  schemas: string[],
  tables: TableInfo[],
  currentSchema: string | null
): SearchableDatabaseObject[] {
  const schemaObjects: SearchableDatabaseObject[] = Array.from(new Set(schemas))
    .sort((left, right) => left.localeCompare(right))
    .map((schema) => ({ kind: "schema", name: schema, schema }));

  if (!currentSchema) return schemaObjects;

  const seenRelations = new Set<string>();
  const relations = tables
    .filter((table) => {
      const key = `${table.schema || currentSchema}\0${table.name}\0${
        table.type || ""
      }`;
      if (seenRelations.has(key)) return false;
      seenRelations.add(key);
      return true;
    })
    .map<SearchableDatabaseObject>((table) => ({
      kind: "relation",
      name: table.name,
      schema: table.schema || currentSchema,
      objectType: table.type || null,
    }))
    .sort(
      (left, right) =>
        left.schema.localeCompare(right.schema) ||
        left.name.localeCompare(right.name)
    );

  return [...schemaObjects, ...relations];
}

export function searchableProjectFilePaths(
  entriesByDirectory: Record<string, ProjectFileEntry[]>
): string[] {
  return Array.from(
    new Set(
      Object.values(entriesByDirectory)
        .flat()
        .filter((entry) => entry.kind === "file" && !entry.isSymlink)
        .map((entry) => entry.relativePath)
    )
  ).sort((left, right) => left.localeCompare(right));
}

export type SearchEverywhereMatchKind =
  | "exact"
  | "initials"
  | "prefix"
  | "word-prefix"
  | "substring"
  | "fuzzy";

export interface SearchEverywhereTextMatch {
  kind: SearchEverywhereMatchKind;
  score: number;
  indices: number[];
}

interface IdentifierWord {
  text: string;
  start: number;
}

const IDENTIFIER_SEPARATOR_RE = /[_\-. /\\]/;

function identifierWords(text: string): IdentifierWord[] {
  const words: IdentifierWord[] = [];
  let start = -1;
  const pushWord = (end: number) => {
    if (start >= 0 && end > start) {
      words.push({ text: text.slice(start, end), start });
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (IDENTIFIER_SEPARATOR_RE.test(character)) {
      pushWord(index);
      start = -1;
      continue;
    }
    if (start < 0) {
      start = index;
      continue;
    }
    const previous = text.charAt(index - 1);
    if (/[a-z]/.test(previous) && /[A-Z]/.test(character)) {
      pushWord(index);
      start = index;
    }
  }
  pushWord(text.length);
  return words;
}

function rangeIndices(start: number, length: number) {
  return Array.from({ length }, (_, index) => start + index);
}

function matchWordPrefixes(words: IdentifierWord[], query: string) {
  type PrefixState = {
    queryIndex: number;
    firstWordIndex: number;
    lastWordIndex: number;
    usedWords: number;
    indices: number[];
  };
  const stateScore = (state: PrefixState) =>
    state.usedWords === 0
      ? 0
      : (state.lastWordIndex - state.firstWordIndex - state.usedWords + 1) *
          10 +
        state.usedWords;
  const retainBest = (
    states: Map<string, PrefixState>,
    candidate: PrefixState,
  ) => {
    const key = `${candidate.queryIndex}:${candidate.usedWords}`;
    const current = states.get(key);
    if (!current || stateScore(candidate) < stateScore(current)) {
      states.set(key, candidate);
    }
  };

  let states = new Map<string, PrefixState>([
    [
      "0:0",
      {
        queryIndex: 0,
        firstWordIndex: -1,
        lastWordIndex: -1,
        usedWords: 0,
        indices: [],
      },
    ],
  ]);
  words.forEach((word, wordIndex) => {
    const nextStates = new Map(states);
    const lowerWord = word.text.toLowerCase();
    states.forEach((state) => {
      const maxLength = Math.min(
        lowerWord.length,
        query.length - state.queryIndex,
      );
      for (let length = 1; length <= maxLength; length += 1) {
        if (
          lowerWord.slice(0, length) !==
          query.slice(state.queryIndex, state.queryIndex + length)
        ) {
          break;
        }
        retainBest(nextStates, {
          queryIndex: state.queryIndex + length,
          firstWordIndex:
            state.usedWords === 0 ? wordIndex : state.firstWordIndex,
          lastWordIndex: wordIndex,
          usedWords: state.usedWords + 1,
          indices: [...state.indices, ...rangeIndices(word.start, length)],
        });
      }
    });
    states = nextStates;
  });

  return [...states.values()]
    .filter(
      (state) => state.queryIndex === query.length && state.usedWords >= 2,
    )
    .sort((left, right) => stateScore(left) - stateScore(right))[0]?.indices;
}

/**
 * Match one quick-open field using DBX-compatible identifier semantics. This
 * deliberately recognizes snake_case, dotted paths, CamelCase initials and a
 * bounded subsequence fallback, so database identifiers behave like symbols
 * rather than generic prose.
 */
export function matchSearchEverywhereText(
  query: string,
  text: string,
): SearchEverywhereTextMatch | null {
  const lowerQuery = query.trim().toLowerCase();
  const lowerText = text.toLowerCase();
  if (!lowerQuery) return { kind: "exact", score: Infinity, indices: [] };
  if (lowerText === lowerQuery) {
    return { kind: "exact", score: 1, indices: rangeIndices(0, text.length) };
  }

  const words = identifierWords(text);
  const initials = words
    .map((word) => word.text[0]?.toLowerCase() || "")
    .join("");
  if (words.length >= 2 && initials === lowerQuery) {
    return {
      kind: "initials",
      score: 100 + Math.min(words.length, 99),
      indices: words.map((word) => word.start),
    };
  }
  if (lowerText.startsWith(lowerQuery)) {
    return {
      kind: "prefix",
      score: 200 + Math.min(text.length - lowerQuery.length, 99),
      indices: rangeIndices(0, lowerQuery.length),
    };
  }

  const wordPrefixIndices = matchWordPrefixes(words, lowerQuery);
  if (wordPrefixIndices) {
    return {
      kind: "word-prefix",
      score: 300 + Math.min(text.length - lowerQuery.length, 99),
      indices: wordPrefixIndices,
    };
  }

  const substringIndex = lowerText.indexOf(lowerQuery);
  if (substringIndex >= 0) {
    return {
      kind: "substring",
      score: 400 + Math.min(substringIndex, 99),
      indices: rangeIndices(substringIndex, lowerQuery.length),
    };
  }
  if (lowerQuery.length < 2) return null;

  const indices: number[] = [];
  let queryIndex = 0;
  for (
    let index = 0;
    index < lowerText.length && queryIndex < lowerQuery.length;
    index += 1
  ) {
    if (lowerText[index] !== lowerQuery[queryIndex]) continue;
    indices.push(index);
    queryIndex += 1;
  }
  if (queryIndex !== lowerQuery.length) return null;
  const span = indices[indices.length - 1]! - indices[0]! + 1;
  return {
    kind: "fuzzy",
    score: 500 + Math.min(span - lowerQuery.length, 99),
    indices,
  };
}

function scoreSearchText(query: string, text: string) {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return matchSearchEverywhereText(query, text)?.score;
  let score = 0;
  for (const token of tokens) {
    const match = matchSearchEverywhereText(token, text);
    if (!match) return undefined;
    score += match.score;
  }
  return score;
}

export function rankSearchEverywhereItems<T>(
  items: T[],
  query: string,
  searchableText: (item: T) => string,
  options: {
    limit?: number;
    emptyLimit?: number;
    primaryText?: (item: T) => string;
  } = {}
): T[] {
  const limit = Math.max(1, options.limit ?? 50);
  const emptyLimit = Math.min(limit, Math.max(1, options.emptyLimit ?? 12));
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items.slice(0, emptyLimit);

  return items
    .map((item, index) => {
      const text = searchableText(item);
      const primary = options.primaryText?.(item) || text;
      const primaryScore = scoreSearchText(normalizedQuery, primary);
      const metadataScore =
        primaryScore === undefined
          ? scoreSearchText(normalizedQuery, text)
          : undefined;
      if (primaryScore === undefined && metadataScore === undefined) return null;
      return {
        item,
        index,
        score: primaryScore ?? 1_000 + (metadataScore || 0),
        label: primary,
      };
    })
    .filter(
      (entry): entry is {
        item: T;
        index: number;
        score: number;
        label: string;
      } =>
        entry !== null
    )
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.label.length - right.label.length ||
        left.label.localeCompare(right.label) ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}
