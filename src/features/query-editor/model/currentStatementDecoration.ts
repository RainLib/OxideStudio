export type OffsetPositionModel = {
  getPositionAt: (offset: number) => { lineNumber: number };
};

export type CurrentStatementLineFrame = {
  lineNumber: number;
  className: string;
};

export type CurrentStatementRange = {
  startOffset: number;
  endOffset: number;
};

export type CurrentStatementRangeCache = {
  modelVersion: number;
  ranges: readonly CurrentStatementRange[];
};

/**
 * Reuses only ranges returned by the authoritative backend scanner and only
 * while the Monaco model version is unchanged. A cursor on an exclusive end
 * boundary is resolved again; whitespace before/between/after ranges follows
 * the backend's first-next/last fallback without copying SQL parsing rules.
 */
export function cachedCurrentStatementRangeAtOffset(
  cache: CurrentStatementRangeCache | null,
  modelVersion: number,
  offset: number,
) {
  if (!cache || cache.modelVersion !== modelVersion) return null;
  let lastRange: CurrentStatementRange | null = null;
  for (const range of cache.ranges) {
    if (range.endOffset <= range.startOffset) continue;
    if (offset === range.endOffset) return null;
    if (offset >= range.startOffset && offset < range.endOffset) return range;
    if (offset < range.startOffset) return range;
    lastRange = range;
  }
  return lastRange;
}

export function currentStatementLineFrames(
  model: OffsetPositionModel,
  startOffset: number,
  endOffset: number,
): CurrentStatementLineFrame[] {
  if (startOffset < 0 || endOffset <= startOffset) return [];
  const start = model.getPositionAt(startOffset);
  const end = model.getPositionAt(Math.max(startOffset, endOffset - 1));
  const frames: CurrentStatementLineFrame[] = [];
  for (let lineNumber = start.lineNumber; lineNumber <= end.lineNumber; lineNumber += 1) {
    const edgeClasses = [
      lineNumber === start.lineNumber ? "oxide-current-statement-start" : "",
      lineNumber === end.lineNumber ? "oxide-current-statement-end" : "",
    ]
      .filter(Boolean)
      .join(" ");
    frames.push({
      lineNumber,
      className: `oxide-current-statement-line ${edgeClasses}`,
    });
  }
  return frames;
}
