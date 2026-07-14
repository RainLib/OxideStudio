export interface EditorTextRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface EditorPatchPreview {
  id: string;
  title: string;
  rationale?: string;
  range: EditorTextRange;
  originalText: string;
  replacement: string;
  expectedRevision: string;
}

export type EditorPatchApplyResult =
  | { status: "success"; text: string; appliedRange: EditorTextRange }
  | { status: "stale" | "invalid" | "notFound"; message: string };

export function fullDocumentRange(text: string): EditorTextRange {
  const lines = text.split(/\r\n|\r|\n/);
  const lastLine = lines[lines.length - 1] || "";
  return {
    startLine: 1,
    startColumn: 1,
    endLine: lines.length,
    endColumn: lastLine.length + 1,
  };
}

export function textInEditorRange(text: string, range: EditorTextRange) {
  const offsets = editorRangeOffsets(text, range);
  return offsets ? text.slice(offsets.start, offsets.end) : null;
}

export function applyEditorTextPatch(
  text: string,
  range: EditorTextRange,
  expectedOriginal: string,
  replacement: string,
): EditorPatchApplyResult {
  const offsets = editorRangeOffsets(text, range);
  if (!offsets) {
    return { status: "invalid", message: "Patch range is outside the document." };
  }
  if (text.slice(offsets.start, offsets.end) !== expectedOriginal) {
    return {
      status: "stale",
      message: "The text inside the proposed range has changed.",
    };
  }
  return {
    status: "success",
    text: `${text.slice(0, offsets.start)}${replacement}${text.slice(offsets.end)}`,
    appliedRange: replacementRange(range, replacement),
  };
}

function editorRangeOffsets(text: string, range: EditorTextRange) {
  if (!isValidRange(range)) return null;
  const start = positionOffset(text, range.startLine, range.startColumn);
  const end = positionOffset(text, range.endLine, range.endColumn);
  if (start === null || end === null || end < start) return null;
  return { start, end };
}

function positionOffset(text: string, line: number, column: number) {
  let currentLine = 1;
  let lineStart = 0;
  for (let index = 0; index < text.length && currentLine < line; index += 1) {
    if (text[index] === "\n") {
      currentLine += 1;
      lineStart = index + 1;
    } else if (text[index] === "\r") {
      currentLine += 1;
      if (text[index + 1] === "\n") index += 1;
      lineStart = index + 1;
    }
  }
  if (currentLine !== line) return null;

  let lineEnd = lineStart;
  while (
    lineEnd < text.length &&
    text[lineEnd] !== "\n" &&
    text[lineEnd] !== "\r"
  ) {
    lineEnd += 1;
  }
  const offset = lineStart + column - 1;
  return offset <= lineEnd ? offset : null;
}

function replacementRange(range: EditorTextRange, replacement: string) {
  const lines = replacement.split(/\r\n|\r|\n/);
  if (lines.length === 1) {
    return {
      ...range,
      endLine: range.startLine,
      endColumn: range.startColumn + (lines[0]?.length || 0),
    };
  }
  return {
    ...range,
    endLine: range.startLine + lines.length - 1,
    endColumn: (lines[lines.length - 1]?.length || 0) + 1,
  };
}

function isValidRange(range: EditorTextRange) {
  const values = [
    range.startLine,
    range.startColumn,
    range.endLine,
    range.endColumn,
  ];
  return (
    values.every((value) => Number.isInteger(value) && value >= 1) &&
    (range.endLine > range.startLine ||
      (range.endLine === range.startLine &&
        range.endColumn >= range.startColumn))
  );
}
