import { hasSavedSqlDrag, readSavedSqlDrag } from "@/lib/savedSqlDrag";
import type { SavedSqlFile } from "@/services/tauri/saved-sql.service";
import { useCallback, type DragEvent as ReactDragEvent } from "react";

interface SavedQueryDropOptions {
  canAcceptExplorerTableDrop: boolean;
  mountedEditor: any;
  activeProjectId: string;
  openSavedSqlFile: (id: string) => Promise<SavedSqlFile | undefined>;
}

export function useSavedQueryDrop({
  canAcceptExplorerTableDrop,
  mountedEditor,
  activeProjectId,
  openSavedSqlFile,
}: SavedQueryDropOptions) {
  const handleSavedSqlDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      if (!canAcceptExplorerTableDrop || !hasSavedSqlDrag(event.dataTransfer))
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    [canAcceptExplorerTableDrop],
  );
  const handleSavedSqlDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      if (!canAcceptExplorerTableDrop || !mountedEditor) return;
      const payload = readSavedSqlDrag(event.dataTransfer);
      if (!payload || payload.projectId !== activeProjectId) return;
      event.preventDefault();
      event.stopPropagation();
      const position =
        mountedEditor.getTargetAtClientPoint?.(event.clientX, event.clientY)
          ?.position ?? mountedEditor.getPosition?.();
      const model = mountedEditor.getModel?.();
      if (!position || !model) return;
      const file = await openSavedSqlFile(payload.fileId);
      if (!file || !file.sql) return;
      const startOffset = model.getOffsetAt(position);
      mountedEditor.pushUndoStop?.();
      mountedEditor.executeEdits("oxide.saved-sql-drop", [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text: file.sql,
          forceMoveMarkers: true,
        },
      ]);
      mountedEditor.pushUndoStop?.();
      mountedEditor.setPosition(
        model.getPositionAt(startOffset + file.sql.length),
      );
      mountedEditor.focus();
    },
    [
      activeProjectId,
      canAcceptExplorerTableDrop,
      mountedEditor,
      openSavedSqlFile,
    ],
  );

  return { handleSavedSqlDragOver, handleSavedSqlDrop };
}
