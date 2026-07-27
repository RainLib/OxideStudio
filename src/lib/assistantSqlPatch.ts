import { documentTextRevision } from "@/lib/documentRevision";
import {
  fullDocumentRange,
  textInEditorRange,
  type EditorPatchPreview,
  type EditorTextRange,
} from "@/lib/editorPatch";

const MAX_ASSISTANT_SQL_PATCH_CHARS = 50_000;
const SQL_FENCE_LANGUAGES = new Set([
  "sql",
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
]);

interface AssistantSqlPatchTab {
  id: string;
  type: string;
  title: string;
  sql: string;
  fileRevision?: string;
  filePreview?: unknown;
  editorSelection?: {
    text: string;
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  } | null;
}

export function isSqlAssistantCodeBlock(language?: string) {
  return SQL_FENCE_LANGUAGES.has((language || "").trim().toLowerCase());
}

export function createAssistantSqlPatchPreview(
  tab: AssistantSqlPatchTab,
  replacement: string,
  patchId: string,
  preferredRange?: EditorTextRange,
): EditorPatchPreview | null {
  if (
    tab.type !== "query" ||
    tab.filePreview ||
    !replacement.trim() ||
    replacement.length > MAX_ASSISTANT_SQL_PATCH_CHARS
  ) {
    return null;
  }
  const range: EditorTextRange =
    preferredRange ||
    (tab.editorSelection?.text.trim()
      ? {
          startLine: tab.editorSelection.startLineNumber,
          startColumn: tab.editorSelection.startColumn,
          endLine: tab.editorSelection.endLineNumber,
          endColumn: tab.editorSelection.endColumn,
        }
      : fullDocumentRange(tab.sql));
  const originalText = textInEditorRange(tab.sql, range);
  if (
    originalText === null ||
    originalText.length > MAX_ASSISTANT_SQL_PATCH_CHARS
  ) {
    return null;
  }

  return {
    id: patchId,
    title: "Review AI SQL correction",
    rationale:
      "Proposed from an Assistant SQL code block. Review before applying; this action does not execute the query.",
    range,
    originalText,
    replacement,
    expectedRevision: documentTextRevision(tab.fileRevision, tab.sql),
  };
}
