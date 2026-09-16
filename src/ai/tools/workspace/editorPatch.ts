import type {
  AiEditorPatchArtifact,
  AiEditorPatchInput,
} from "@/ai/tools/types";
import { createRequestId } from "@/ai/tools/workspace/queryIdentity";
import { documentTextRevision } from "@/lib/documentRevision";
import {
  fullDocumentRange,
  textInEditorRange,
  type EditorTextRange,
} from "@/lib/editorPatch";
import { useTabStore } from "@/store/useTabStore";

const MAX_EDITOR_PATCH_TEXT = 50_000;

export function proposeEditorPatch(
  input: AiEditorPatchInput,
): AiEditorPatchArtifact {
  const tabState = useTabStore.getState();
  const tabId = input.tabId || tabState.activeTabId;
  const tab = tabState.tabs.find((candidate) => candidate.id === tabId);
  if (!tab || tab.type !== "query" || tab.filePreview) {
    throw new Error(
      "A writable SQL editor tab is required for a patch proposal",
    );
  }
  const range: EditorTextRange =
    input.range ||
    (tab.editorSelection
      ? {
          startLine: tab.editorSelection.startLineNumber,
          startColumn: tab.editorSelection.startColumn,
          endLine: tab.editorSelection.endLineNumber,
          endColumn: tab.editorSelection.endColumn,
        }
      : fullDocumentRange(tab.sql));
  const originalText = textInEditorRange(tab.sql, range);
  if (originalText === null)
    throw new Error("Patch range is outside the editor document");
  if (
    originalText.length > MAX_EDITOR_PATCH_TEXT ||
    input.replacement.length > MAX_EDITOR_PATCH_TEXT
  ) {
    throw new Error(
      "Patch text exceeds 50,000 characters; select a narrower editor range",
    );
  }
  const revision = documentTextRevision(tab.fileRevision, tab.sql);
  return {
    patchId: `patch-${createRequestId()}`,
    tabId: tab.id,
    tabTitle: tab.title,
    range,
    originalText,
    replacement: input.replacement,
    documentRevision: revision,
    title: input.title?.trim().slice(0, 160) || "AI SQL patch",
    rationale: input.rationale?.trim().slice(0, 2_000) || null,
  };
}
