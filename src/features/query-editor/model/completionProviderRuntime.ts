import { type SqlBatchColumnDialogSession } from "@/components/workspace/SqlBatchColumnDialog";
import { normalizeKeybinding } from "@/lib/keybindings";
import { type Diagnostic as LspDiagnostic } from "@/services/lsp/types";

export const RECORD_COMPLETION_USAGE_COMMAND =
  "oxide.sqlCompletion.recordUsage";
export const OPEN_BATCH_COLUMN_SELECTION_COMMAND =
  "oxide.sqlCompletion.openBatchColumns";

export type SqlBatchColumnRuntimeSession = SqlBatchColumnDialogSession & {
  context?: import("@/services/lsp/semanticContext").CompletionContextSnapshot;
  ownerKey: string;
  uri: string;
  modelVersion: number;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
  replacedText: string;
};
export const MAX_QUERY_EDITOR_COMPLETION_SUGGESTIONS = 640;

export function createInlineCompletionRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `inline-${crypto.randomUUID()}`;
  }
  return `inline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function toMonacoKeybinding(monaco: any, binding: string) {
  const parts = normalizeKeybinding(binding).split("+").filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const namedKeys: Record<string, number | undefined> = {
    tab: monaco.KeyCode.Tab,
    enter: monaco.KeyCode.Enter,
    escape: monaco.KeyCode.Escape,
    space: monaco.KeyCode.Space,
    arrowleft: monaco.KeyCode.LeftArrow,
    arrowright: monaco.KeyCode.RightArrow,
    arrowup: monaco.KeyCode.UpArrow,
    arrowdown: monaco.KeyCode.DownArrow,
    "\\": monaco.KeyCode.Backslash,
  };
  const keyCode =
    namedKeys[key] ||
    (key.length === 1 && /[a-z]/.test(key)
      ? monaco.KeyCode[`Key${key.toUpperCase()}`]
      : key.length === 1 && /\d/.test(key)
        ? monaco.KeyCode[`Digit${key}`]
        : undefined);
  if (!keyCode) return null;
  return (
    keyCode |
    (parts.includes("mod") ? monaco.KeyMod.CtrlCmd : 0) |
    (parts.includes("alt") ? monaco.KeyMod.Alt : 0) |
    (parts.includes("shift") ? monaco.KeyMod.Shift : 0)
  );
}

export function mongodbJsonStringCompletionRange(
  monaco: any,
  model: any,
  position: any,
) {
  const line = model.getLineContent(position.lineNumber);
  const cursorIndex = position.column - 1;
  let openQuote = -1;
  let escaping = false;

  for (let index = 0; index < cursorIndex; index += 1) {
    const character = line[index];
    if (openQuote >= 0) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') openQuote = -1;
    } else if (character === '"') {
      openQuote = index;
    }
  }

  if (openQuote >= 0) {
    let closingQuote = cursorIndex;
    escaping = false;
    for (; closingQuote < line.length; closingQuote += 1) {
      const character = line[closingQuote];
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') break;
    }
    return new monaco.Range(
      position.lineNumber,
      openQuote + 2,
      position.lineNumber,
      closingQuote + 1,
    );
  }

  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}

export function lspDiagnosticOverlapsOffsetRange(
  model: {
    getOffsetAt(position: { lineNumber: number; column: number }): number;
  },
  diagnostic: LspDiagnostic,
  range: { from: number; to: number },
) {
  const start = model.getOffsetAt({
    lineNumber: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
  });
  const rawEnd = model.getOffsetAt({
    lineNumber: diagnostic.range.end.line + 1,
    column: diagnostic.range.end.character + 1,
  });
  const end = Math.max(start + 1, rawEnd);
  return start < range.to && end > range.from;
}
