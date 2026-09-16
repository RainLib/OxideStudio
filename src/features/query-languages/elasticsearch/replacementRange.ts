import { type ElasticsearchCompletionReplacementRange } from "@/features/query-languages/elasticsearch/types";

/**
 * Returns the complete JSON key token around the caret, including an
 * auto-closed or existing suffix quote. Monaco can then replace the key as one
 * unit instead of leaving a duplicate quote or half of the old identifier.
 */
export function elasticsearchJsonKeyReplacementRange(
  source: string,
  cursorOffset: number,
): ElasticsearchCompletionReplacementRange | null {
  const cursor = Math.max(0, Math.min(cursorOffset, source.length));
  const lineStart = source.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const lineEndIndex = source.indexOf("\n", cursor);
  const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
  const beforeCursor = source.slice(lineStart, cursor);
  const fragment = beforeCursor.match(/"[\w.@*-]*$|[\w.@*-]+$/u)?.[0];
  if (!fragment) return null;

  let endOffset = cursor;
  while (endOffset < lineEnd && /[\w.@*-]/u.test(source[endOffset] || "")) {
    endOffset += 1;
  }
  const quoted = fragment.startsWith('"');
  if (quoted && source[endOffset] === '"') endOffset += 1;
  return {
    startOffset: cursor - fragment.length,
    endOffset,
    quoted,
  };
}

export function hasElasticsearchJsonKeySeparator(
  source: string,
  cursorOffset: number,
) {
  const range = elasticsearchJsonKeyReplacementRange(source, cursorOffset);
  if (!range?.quoted) return false;
  let offset = range.endOffset;
  while (source[offset] === " " || source[offset] === "\t") offset += 1;
  return source[offset] === ":";
}
