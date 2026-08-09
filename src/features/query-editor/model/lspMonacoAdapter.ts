import type {
  Diagnostic,
  LspSelectionRange,
  PublishDiagnosticsParams,
  Range as LspRange,
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
  return typeof documentation === "string"
    ? documentation
    : documentation.value
      ? { value: documentation.value }
      : undefined;
}

export function toMonacoRange(monaco: any, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
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
