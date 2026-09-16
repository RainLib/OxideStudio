import type { AiExplainedDiagnostic } from "@/ai/tools/types";
import type { Diagnostic } from "@/services/lsp/types";
import { type EditorSelectionState } from "@/store/useTabStore";

export function explainDiagnostic(
  diagnostic: Diagnostic,
  lines: string[],
): AiExplainedDiagnostic {
  const severityLabel = diagnosticSeverityLabel(diagnostic.severity);
  const lineNumber = diagnostic.range.start.line + 1;
  const startColumn = diagnostic.range.start.character + 1;
  const endLineNumber = diagnostic.range.end.line + 1;
  const endColumn = diagnostic.range.end.character + 1;
  const lineText = lines[lineNumber - 1] ?? null;

  return {
    ...diagnostic,
    severityLabel,
    location:
      lineNumber === endLineNumber
        ? `line ${lineNumber}, columns ${startColumn}-${endColumn}`
        : `lines ${lineNumber}-${endLineNumber}`,
    lineText,
    explanation: diagnosticExplanation(diagnostic.message, severityLabel),
  };
}

export function diagnosticSeverityLabel(
  severity: number | undefined,
): AiExplainedDiagnostic["severityLabel"] {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  if (severity === 3) return "information";
  if (severity === 4) return "hint";
  return "unknown";
}

function diagnosticExplanation(
  message: string,
  severity: ReturnType<typeof diagnosticSeverityLabel>,
) {
  if (severity === "error") {
    return `The LSP reported a blocking syntax or semantic problem: ${message}`;
  }
  if (severity === "warning") {
    return `The LSP reported a likely issue that may still execute: ${message}`;
  }
  if (severity === "information") {
    return `The LSP reported an informational note: ${message}`;
  }
  if (severity === "hint") {
    return `The LSP suggested an editor hint: ${message}`;
  }
  return `The LSP reported: ${message}`;
}

export function diagnosticsSummary(
  diagnostics: AiExplainedDiagnostic[],
  onlySelection: boolean,
  severity: string | null,
) {
  const scope = onlySelection ? "selection" : "active tab";
  const filter = severity ? ` ${severity}` : "";
  if (diagnostics.length === 0) {
    return `No${filter} LSP diagnostics found for the ${scope}.`;
  }

  const counts = diagnostics.reduce<Record<string, number>>(
    (acc, diagnostic) => {
      acc[diagnostic.severityLabel] = (acc[diagnostic.severityLabel] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const countText = Object.entries(counts)
    .map(([label, count]) => `${count} ${label}`)
    .join(", ");
  return `Found ${diagnostics.length} LSP diagnostic(s) for the ${scope}: ${countText}.`;
}

export function diagnosticOverlapsSelection(
  diagnostic: Diagnostic,
  selection: EditorSelectionState,
) {
  const diagnosticStart = {
    line: diagnostic.range.start.line + 1,
    column: diagnostic.range.start.character + 1,
  };
  const diagnosticEnd = {
    line: diagnostic.range.end.line + 1,
    column: diagnostic.range.end.character + 1,
  };
  const selectionStart = {
    line: selection.startLineNumber,
    column: selection.startColumn,
  };
  const selectionEnd = {
    line: selection.endLineNumber,
    column: selection.endColumn,
  };

  return (
    comparePosition(diagnosticEnd, selectionStart) >= 0 &&
    comparePosition(diagnosticStart, selectionEnd) <= 0
  );
}

function comparePosition(
  left: { line: number; column: number },
  right: { line: number; column: number },
) {
  if (left.line !== right.line) return left.line - right.line;
  return left.column - right.column;
}
