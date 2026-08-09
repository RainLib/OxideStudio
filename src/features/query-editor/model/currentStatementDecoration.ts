export type OffsetPositionModel = {
  getPositionAt: (offset: number) => { lineNumber: number };
};

export type CurrentStatementLineFrame = {
  lineNumber: number;
  className: string;
};

export type CurrentStatementRangeCache = {
  modelVersion: number;
  startOffset: number;
  endOffset: number;
};

/**
 * Reuses only a range returned by the authoritative backend scanner and only
 * while the Monaco model version is unchanged.  A cursor on the exclusive end
 * boundary is resolved again so adjacent statements and delimiters cannot
 * inherit the previous frame.
 */
export function cachedCurrentStatementRangeAtOffset(
  cache: CurrentStatementRangeCache | null,
  modelVersion: number,
  offset: number,
) {
  if (
    !cache ||
    cache.modelVersion !== modelVersion ||
    cache.endOffset <= cache.startOffset ||
    offset < cache.startOffset ||
    offset >= cache.endOffset
  ) {
    return null;
  }
  return cache;
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
