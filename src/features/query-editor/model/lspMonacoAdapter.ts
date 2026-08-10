import type {
  Diagnostic,
  InsertReplaceEdit,
  LspSelectionRange,
  PublishDiagnosticsParams,
  Range as LspRange,
  TextEdit,
  WorkspaceEdit,
} from "@/services/lsp/types";

/** Converts protocol values into Monaco's one-based presentation model. */
export function lspDocumentationForMonaco(
  documentation:
    | string
    | { kind?: string; value?: string }
    | undefined,
) {
  if (!documentation) return undefined;
  if (typeof documentation === "string") return documentation;
  if (!documentation.value) return undefined;
  return documentation.kind?.toLocaleLowerCase() === "markdown"
    ? {
        value: documentation.value,
        isTrusted: false,
        supportHtml: false,
      }
    : documentation.value;
}

export function toMonacoRange(monaco: any, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

/** Preserves the different insert and replace boundaries supported by LSP 3.17. */
export function toMonacoCompletionRange(
  monaco: any,
  edit: TextEdit | InsertReplaceEdit,
) {
  if ("range" in edit) return toMonacoRange(monaco, edit.range);
  return {
    insert: toMonacoRange(monaco, edit.insert),
    replace: toMonacoRange(monaco, edit.replace),
  };
}

export function toMonacoWorkspaceEdit(monaco: any, edit: WorkspaceEdit) {
  return {
    edits: Object.entries(edit.changes || {}).flatMap(([uri, textEdits]) =>
      textEdits.map((textEdit) => {
        const resource = monaco.Uri.parse(uri);
        return {
          resource,
          textEdit: {
            range: toMonacoRange(monaco, textEdit.range),
            text: textEdit.newText,
          },
          versionId: monaco.editor.getModel(resource)?.getVersionId(),
        };
      }),
    ),
  };
}

export function flattenLspSelectionRanges(
  monaco: any,
  selection: LspSelectionRange | undefined,
) {
  const ranges = [];
  let current = selection;
  while (current) {
    ranges.push({ range: toMonacoRange(monaco, current.range) });
    current = current.parent;
  }
  return ranges;
}

export function isPublishDiagnosticsParams(
  value: unknown,
): value is PublishDiagnosticsParams {
  if (!value || typeof value !== "object") return false;
  const params = value as PublishDiagnosticsParams;
  return typeof params.uri === "string" && Array.isArray(params.diagnostics);
}

/**
 * Diagnostics are asynchronous notifications, so they need the same document
 * ownership checks as completion and hover responses. A versioned server
 * notification must match the latest synchronized LSP version; even an
 * unversioned notification is rejected when the Monaco text has moved ahead
 * of the synchronized shadow document.
 */
export function shouldApplyLspDiagnostics(options: {
  diagnosticsVersion?: number;
  currentDocumentVersion?: number;
  modelText: string;
  synchronizedText?: string;
}) {
  if (
    options.diagnosticsVersion !== undefined &&
    options.diagnosticsVersion !== options.currentDocumentVersion
  ) {
    return false;
  }
  return (
    options.synchronizedText === undefined ||
    options.synchronizedText === options.modelText
  );
}

export function toMonacoMarkerSeverity(monaco: any, severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    case 4:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Warning;
  }
}

export function lspDiagnosticToMonacoMarker(monaco: any, diagnostic: Diagnostic) {
  const startLineNumber = diagnostic.range.start.line + 1;
  const startColumn = diagnostic.range.start.character + 1;
  const endLineNumber = diagnostic.range.end.line + 1;
  let endColumn = diagnostic.range.end.character + 1;

  // Monaco does not render zero-width markers. Keep point diagnostics visible.
  if (startLineNumber === endLineNumber && endColumn <= startColumn) {
    endColumn = startColumn + 1;
  }

  return {
    severity: toMonacoMarkerSeverity(monaco, diagnostic.severity),
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    message: diagnostic.message,
    source: diagnostic.source || "sql-lsp",
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn,
  };
}
