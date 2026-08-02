export type OffsetPositionModel = {
  getPositionAt: (offset: number) => { lineNumber: number };
};

export type CurrentStatementLineFrame = {
  lineNumber: number;
  className: string;
};

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
