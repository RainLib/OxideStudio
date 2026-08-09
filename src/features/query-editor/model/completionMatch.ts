const HAN_CHARACTER = /\p{Script=Han}/u;
const ASCII_QUERY = /^[a-z0-9]+$/u;
const ASCII_ALPHANUMERIC = /[a-z0-9]/iu;
const MAX_PINYIN_CACHE_ENTRIES = 20_000;
const pinyinInitialCache = new Map<string, string>();
type PinyinConverter = typeof import("pinyin-pro")["pinyin"];
let pinyinConverter: PinyinConverter | null = null;
let pinyinLoad: Promise<void> | null = null;

/** Loads the sizeable pinyin dictionary only for catalogs that need it. */
export function ensurePinyinCompletionSupport() {
  if (pinyinConverter) return Promise.resolve();
  if (!pinyinLoad) {
    pinyinLoad = import("pinyin-pro").then((module) => {
      pinyinConverter = module.pinyin;
      pinyinInitialCache.clear();
    });
  }
  return pinyinLoad;
}

export function containsHan(value: string) {
  return HAN_CHARACTER.test(value);
}

/**
 * Produces the searchable initials used by database IDEs for Chinese object
 * names. ASCII segments remain searchable, while punctuation is ignored.
 * The bounded LRU-style cache keeps large catalogs out of the typing hot path.
 */
export function pinyinInitials(value: string) {
  const cached = pinyinInitialCache.get(value);
  if (cached !== undefined) {
    pinyinInitialCache.delete(value);
    pinyinInitialCache.set(value, cached);
    return cached;
  }

  const needsPinyin = containsHan(value);
  if (needsPinyin && !pinyinConverter) return "";
  let result = "";
  for (const character of value) {
    if (HAN_CHARACTER.test(character)) {
      result += pinyinConverter!(character, {
        pattern: "first",
        toneType: "none",
      });
    } else if (ASCII_ALPHANUMERIC.test(character)) {
      result += character.toLocaleLowerCase();
    }
  }

  if (pinyinInitialCache.size >= MAX_PINYIN_CACHE_ENTRIES) {
    const oldest = pinyinInitialCache.keys().next().value;
    if (oldest !== undefined) pinyinInitialCache.delete(oldest);
  }
  pinyinInitialCache.set(value, result);
  return result;
}

function orderedSubsequenceSpan(haystack: string, needle: string) {
  let nextOffset = 0;
  let firstOffset = -1;
  let lastOffset = -1;
  for (const character of needle) {
    const offset = haystack.indexOf(character, nextOffset);
    if (offset < 0) return null;
    if (firstOffset < 0) firstOffset = offset;
    lastOffset = offset;
    nextOffset = offset + character.length;
  }
  return firstOffset < 0
    ? null
    : { first: firstOffset, span: lastOffset - firstOffset + 1 };
}

function identifierInitials(value: string) {
  let initials = "";
  let atBoundary = true;
  let previousLowercase = false;
  for (const character of value) {
    if (!/[a-z0-9]/iu.test(character)) {
      atBoundary = true;
      previousLowercase = false;
      continue;
    }
    if (atBoundary || (previousLowercase && /[A-Z]/u.test(character))) {
      initials += character.toLocaleLowerCase();
    }
    atBoundary = false;
    previousLowercase = /[a-z]/u.test(character);
  }
  return initials;
}

/** Returns -1 for no match; larger values are better. */
export function completionMatchScore(candidate: string, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return 0;
  const normalizedCandidate = candidate.toLocaleLowerCase();
  if (normalizedCandidate === normalizedQuery) return 5_000;
  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return 4_000 - normalizedCandidate.length;
  }

  const initials = identifierInitials(candidate);
  if (initials.startsWith(normalizedQuery)) {
    return 3_600 - initials.length;
  }

  if (ASCII_QUERY.test(normalizedQuery) && containsHan(candidate)) {
    const pinyin = pinyinInitials(candidate);
    if (pinyin.startsWith(normalizedQuery)) return 3_400 - pinyin.length;
    const match = orderedSubsequenceSpan(pinyin, normalizedQuery);
    if (match) {
      return 2_400 - match.first * 30 - (match.span - normalizedQuery.length) * 10;
    }
  }

  const substring = normalizedCandidate.indexOf(normalizedQuery);
  if (substring >= 0) return 2_800 - substring * 10 - normalizedCandidate.length;
  const fuzzy = orderedSubsequenceSpan(normalizedCandidate, normalizedQuery);
  return fuzzy
    ? 1_600 - fuzzy.first * 20 - (fuzzy.span - normalizedQuery.length) * 10
    : -1;
}

export function completionMatches(candidate: string, query: string) {
  return completionMatchScore(candidate, query) >= 0;
}

/**
 * Monaco filters a provider result again. When the label matched via initials
 * or pinyin, use the exact typed query as filter text so that valid metadata
 * is not discarded by Monaco's ASCII label matcher.
 */
export function completionFilterTextForQuery(
  candidate: string,
  query: string,
  existing?: string,
) {
  if (!query || candidate.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
    return existing;
  }
  return completionMatches(candidate, query) ? query : existing;
}

export function resetCompletionMatchCacheForTests() {
  pinyinInitialCache.clear();
}
