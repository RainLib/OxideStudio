export type LineDiffOperation = {
  type: "equal" | "add" | "delete";
  lines: string[];
};

export type LineDiffHunk = {
  id: string;
  originalStartLine: number;
  originalEndLine: number;
  modifiedStartLine: number;
  modifiedEndLine: number;
  originalLines: string[];
  modifiedLines: string[];
  additions: number;
  deletions: number;
};

function linesOf(text: string) {
  return text.match(/[^\n]*\n|[^\n]+/gu) ?? [];
}

function frontierValue(frontier: Map<number, number>, diagonal: number) {
  return frontier.get(diagonal) ?? Number.NEGATIVE_INFINITY;
}

export function lineDiffOperations(
  originalText: string,
  modifiedText: string,
): LineDiffOperation[] {
  if (originalText === modifiedText) {
    return [{ type: "equal", lines: linesOf(originalText) }];
  }

  const original = linesOf(originalText);
  const modified = linesOf(modifiedText);
  const maximum = original.length + modified.length;
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Array<Map<number, number>> = [];

  for (let distance = 0; distance <= maximum; distance += 1) {
    trace.push(new Map(frontier));
    for (
      let diagonal = -distance;
      diagonal <= distance;
      diagonal += 2
    ) {
      let originalIndex: number;
      if (
        diagonal === -distance ||
        (diagonal !== distance &&
          frontierValue(frontier, diagonal - 1) <
            frontierValue(frontier, diagonal + 1))
      ) {
        originalIndex = frontierValue(frontier, diagonal + 1);
      } else {
        originalIndex = frontierValue(frontier, diagonal - 1) + 1;
      }
      if (!Number.isFinite(originalIndex)) originalIndex = 0;
      let modifiedIndex = originalIndex - diagonal;
      while (
        originalIndex < original.length &&
        modifiedIndex < modified.length &&
        original[originalIndex] === modified[modifiedIndex]
      ) {
        originalIndex += 1;
        modifiedIndex += 1;
      }
      frontier.set(diagonal, originalIndex);
      if (
        originalIndex >= original.length &&
        modifiedIndex >= modified.length
      ) {
        return compactOperations(
          backtrackLineDiff(trace, original, modified, distance),
        );
      }
    }
  }

  return compactOperations([
    ...original.map((line) => ({ type: "delete" as const, line })),
    ...modified.map((line) => ({ type: "add" as const, line })),
  ]);
}

function backtrackLineDiff(
  trace: Array<Map<number, number>>,
  original: string[],
  modified: string[],
  distance: number,
) {
  const reversed: Array<{
    type: LineDiffOperation["type"];
    line: string;
  }> = [];
  let originalIndex = original.length;
  let modifiedIndex = modified.length;

  for (let currentDistance = distance; currentDistance >= 0; currentDistance -= 1) {
    const frontier = trace[currentDistance]!;
    const diagonal = originalIndex - modifiedIndex;
    const previousDiagonal =
      diagonal === -currentDistance ||
      (diagonal !== currentDistance &&
        frontierValue(frontier, diagonal - 1) <
          frontierValue(frontier, diagonal + 1))
        ? diagonal + 1
        : diagonal - 1;
    const previousOriginal = Math.max(
      0,
      frontierValue(frontier, previousDiagonal),
    );
    const previousModified = previousOriginal - previousDiagonal;

    while (
      originalIndex > previousOriginal &&
      modifiedIndex > previousModified
    ) {
      reversed.push({
        type: "equal",
        line: original[originalIndex - 1]!,
      });
      originalIndex -= 1;
      modifiedIndex -= 1;
    }
    if (currentDistance === 0) break;

    if (originalIndex === previousOriginal) {
      reversed.push({
        type: "add",
        line: modified[modifiedIndex - 1]!,
      });
      modifiedIndex -= 1;
    } else {
      reversed.push({
        type: "delete",
        line: original[originalIndex - 1]!,
      });
      originalIndex -= 1;
    }
  }

  return reversed.reverse();
}

function compactOperations(
  entries: Array<{ type: LineDiffOperation["type"]; line: string }>,
) {
  const operations: LineDiffOperation[] = [];
  for (const entry of entries) {
    const previous = operations[operations.length - 1];
    if (previous?.type === entry.type) {
      previous.lines.push(entry.line);
    } else {
      operations.push({ type: entry.type, lines: [entry.line] });
    }
  }
  return operations;
}

export function createLineDiffHunks(
  originalText: string,
  modifiedText: string,
): LineDiffHunk[] {
  const operations = lineDiffOperations(originalText, modifiedText);
  const hunks: LineDiffHunk[] = [];
  let originalLine = 1;
  let modifiedLine = 1;
  let pending:
    | Omit<LineDiffHunk, "id" | "originalEndLine" | "modifiedEndLine">
    | undefined;

  const flush = () => {
    if (!pending) return;
    const originalEndLine =
      pending.originalStartLine + pending.originalLines.length - 1;
    const modifiedEndLine =
      pending.modifiedStartLine + pending.modifiedLines.length - 1;
    hunks.push({
      ...pending,
      id: `${pending.originalStartLine}:${originalEndLine}:${pending.modifiedStartLine}:${modifiedEndLine}:${pending.additions}:${pending.deletions}`,
      originalEndLine,
      modifiedEndLine,
    });
    pending = undefined;
  };

  for (const operation of operations) {
    if (operation.type === "equal") {
      flush();
      originalLine += operation.lines.length;
      modifiedLine += operation.lines.length;
      continue;
    }
    pending ??= {
      originalStartLine: originalLine,
      modifiedStartLine: modifiedLine,
      originalLines: [],
      modifiedLines: [],
      additions: 0,
      deletions: 0,
    };
    if (operation.type === "delete") {
      pending.originalLines.push(...operation.lines);
      pending.deletions += operation.lines.length;
      originalLine += operation.lines.length;
    } else {
      pending.modifiedLines.push(...operation.lines);
      pending.additions += operation.lines.length;
      modifiedLine += operation.lines.length;
    }
  }
  flush();
  return hunks;
}

export function applyLineDiffHunk(
  originalText: string,
  modifiedText: string,
  hunk: LineDiffHunk,
  direction: "accept" | "reject",
) {
  if (direction === "accept") {
    const original = linesOf(originalText);
    original.splice(
      hunk.originalStartLine - 1,
      hunk.originalLines.length,
      ...hunk.modifiedLines,
    );
    return original.join("");
  }
  const modified = linesOf(modifiedText);
  modified.splice(
    hunk.modifiedStartLine - 1,
    hunk.modifiedLines.length,
    ...hunk.originalLines,
  );
  return modified.join("");
}

export function lineDiffCounts(originalText: string, modifiedText: string) {
  return createLineDiffHunks(originalText, modifiedText).reduce(
    (total, hunk) => ({
      additions: total.additions + hunk.additions,
      deletions: total.deletions + hunk.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}
