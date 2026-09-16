import type { IPosition, IRange, languages } from "monaco-editor";
import type { InlineLspContext } from "@/services/tauri/ai.service";

/** Semantic context enriches AI; a restarting language server must not gate it. */
export async function optionalInlineLspContext(options: {
  available: boolean;
  load: () => Promise<InlineLspContext>;
  timeoutMs?: number;
}): Promise<{ context: InlineLspContext; available: boolean }> {
  const fallback = { context: {}, available: false };
  if (!options.available) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(options.load)
        .then(
          (context) => ({ context, available: true }),
          () => fallback,
        ),
      new Promise<typeof fallback>((resolve) => {
        timer = setTimeout(() => resolve(fallback), options.timeoutMs ?? 600);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A language-server restart during generation must not stall the result. */
export async function optionalInlineLspValidation(options: {
  available: boolean;
  load: () => Promise<NonNullable<InlineLspContext["diagnostics"]>>;
}) {
  const result = await optionalInlineLspContext({
    available: options.available,
    load: async () => ({ diagnostics: await options.load() }),
  });
  return result.context.diagnostics ?? [];
}

/** Extend the selected completion's range so Monaco can show compatible ghost text. */
export function inlineCompletionEdit(options: {
  text: string;
  position: IPosition;
  selectedSuggestion?: languages.SelectedSuggestionInfo;
  model: {
    getLineMaxColumn(lineNumber: number): number;
    getValueInRange(range: IRange): string;
  };
}): { insertText: string; range: IRange } | null {
  const { position, model, selectedSuggestion: selected } = options;
  if (!options.text) return null;
  const text =
    options.text.includes("\n") &&
    position.column < model.getLineMaxColumn(position.lineNumber)
      ? options.text.split("\n", 1)[0]
      : options.text;
  if (!text) return null;
  const pointRange = {
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  };
  if (!selected) return { insertText: text, range: pointRange };
  const range = selected.range;
  if (
    selected.isSnippetText ||
    range.startLineNumber !== position.lineNumber ||
    range.endLineNumber !== position.lineNumber ||
    range.startColumn > position.column ||
    range.endColumn < position.column
  ) return null;
  const before = model.getValueInRange({ ...range, endColumn: position.column });
  const after = model.getValueInRange({ ...range, startColumn: position.column });
  const insertText = before + text + after;
  return insertText.startsWith(selected.text) ? { insertText, range } : null;
}
