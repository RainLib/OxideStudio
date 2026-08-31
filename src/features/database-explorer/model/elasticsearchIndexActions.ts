import type { SearchIndexClearResult } from "@/services/tauri/types";

export function isElasticsearchIndexPattern(index: string): boolean {
  return index.includes("*") || index.includes("?");
}

export function matchesElasticsearchIndexPattern(
  pattern: string,
  index: string,
): boolean {
  const match = (patternOffset: number, indexOffset: number): boolean => {
    while (patternOffset < pattern.length) {
      const character = pattern[patternOffset];
      if (character === "*") {
        for (let next = indexOffset; next <= index.length; next += 1) {
          if (match(patternOffset + 1, next)) return true;
        }
        return false;
      }
      if (indexOffset >= index.length) return false;
      if (character !== "?" && character !== index[indexOffset]) return false;
      patternOffset += 1;
      indexOffset += 1;
    }
    return indexOffset === index.length;
  };
  return match(0, 0);
}

export function searchIndexClearTouched(
  clearedTarget: string,
  openIndex: string,
): boolean {
  return isElasticsearchIndexPattern(clearedTarget)
    ? matchesElasticsearchIndexPattern(clearedTarget, openIndex)
    : clearedTarget === openIndex;
}

export function isPartialSearchIndexClear(
  result: SearchIndexClearResult,
): boolean {
  return (
    result.timedOut ||
    result.failures.length > 0 ||
    result.versionConflicts > 0 ||
    result.deleted < result.total
  );
}
