import { shouldRetriggerDocumentCompletion } from "@/features/query-editor/model/documentCompletionRefresh";
import { invalidateDocumentMetadataScope } from "@/services/documentMetadataCache";
import { useCallback, useEffect, useRef, type RefObject } from "react";
interface DocumentCompletionRefreshOptions {
  editorRef: RefObject<any>;
  completionTriggerOriginRef: RefObject<"explicit" | "chained" | null>;
  metadataVersion: number;
  activeProjectId: string;
  effectiveConnectionId: string | null;
}
export function useDocumentCompletionRefresh({
  editorRef,
  completionTriggerOriginRef,
  metadataVersion,
  activeProjectId,
  effectiveConnectionId,
}: DocumentCompletionRefreshOptions) {
  const documentMetadataVersionRef = useRef(metadataVersion);

  const retriggerActiveDocumentCompletion = useCallback(
    (request: {
      model: any;
      position: { lineNumber: number; column: number };
      modelVersion: number;
      token: { isCancellationRequested?: boolean };
    }) => {
      // Monaco cancels the provider token when the suggest session closes.
      // Combining that signal with model, cursor and focus checks prevents a
      // stale metadata refresh from reopening completion after the user has
      // moved on to another document or interaction.
      window.setTimeout(() => {
        const editor = editorRef.current;
        if (!shouldRetriggerDocumentCompletion(editor, request)) {
          return;
        }
        completionTriggerOriginRef.current = "chained";
        editor.trigger(
          "oxide.documentMetadataRefresh",
          "editor.action.triggerSuggest",
          {},
        );
        window.setTimeout(() => {
          if (completionTriggerOriginRef.current === "chained") {
            completionTriggerOriginRef.current = null;
          }
        }, 0);
      }, 0);
    },
    [],
  );

  useEffect(() => {
    if (documentMetadataVersionRef.current === metadataVersion) return;
    documentMetadataVersionRef.current = metadataVersion;
    if (!effectiveConnectionId) return;
    const projectScope = activeProjectId || "local";
    invalidateDocumentMetadataScope({
      projectId: projectScope,
      connectionId: effectiveConnectionId,
      driver: "mongodb",
    });
    invalidateDocumentMetadataScope({
      projectId: projectScope,
      connectionId: effectiveConnectionId,
      driver: "elasticsearch",
    });
  }, [activeProjectId, effectiveConnectionId, metadataVersion]);
  return { retriggerActiveDocumentCompletion };
}
