import {
  explorerTableReferenceInsertText,
  OXIDE_TABLE_REFERENCE_DRAG_END_EVENT,
  OXIDE_TABLE_REFERENCE_DROP_EVENT,
  OXIDE_TABLE_REFERENCE_HOVER_EVENT,
  type ExplorerTableReferenceDropDetail,
  type ExplorerTableReferenceHoverDetail,
} from "@/features/query-editor/model/explorerTableReferenceDrop";
import { useEffect } from "react";

interface ExplorerTableDropContext {
  tableDropCaretRef: React.RefObject<HTMLSpanElement | null>;
  canAcceptExplorerTableDrop: boolean;
  mountedEditor: any;
  tableDropTargetRef: React.RefObject<HTMLDivElement | null>;
}

export function useExplorerTableDrop({
  tableDropCaretRef,
  canAcceptExplorerTableDrop,
  mountedEditor,
  tableDropTargetRef,
}: ExplorerTableDropContext) {
  useEffect(() => {
    const hideCaret = () => {
      if (tableDropCaretRef.current) {
        tableDropCaretRef.current.style.display = "none";
      }
    };
    if (!canAcceptExplorerTableDrop || !mountedEditor) {
      hideCaret();
      return;
    }
    const ownsPoint = (clientX: number, clientY: number) => {
      const target = document.elementFromPoint(clientX, clientY);
      return Boolean(target && tableDropTargetRef.current?.contains(target));
    };
    const editorPositionAt = (clientX: number, clientY: number) =>
      mountedEditor.getTargetAtClientPoint?.(clientX, clientY)?.position ??
      null;
    const onHover = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<ExplorerTableReferenceHoverDetail>;
      if (!ownsPoint(event.detail.clientX, event.detail.clientY)) {
        hideCaret();
        return;
      }
      const position = editorPositionAt(
        event.detail.clientX,
        event.detail.clientY,
      );
      const visible = position
        ? mountedEditor.getScrolledVisiblePosition?.(position)
        : null;
      const editorNode = mountedEditor.getDomNode?.() as HTMLElement | null;
      const targetNode = tableDropTargetRef.current;
      const caret = tableDropCaretRef.current;
      if (!visible || !editorNode || !targetNode || !caret) {
        hideCaret();
        return;
      }
      const editorRect = editorNode.getBoundingClientRect();
      const targetRect = targetNode.getBoundingClientRect();
      caret.style.display = "block";
      caret.style.left = `${editorRect.left - targetRect.left + visible.left}px`;
      caret.style.top = `${editorRect.top - targetRect.top + visible.top}px`;
      caret.style.height = `${visible.height}px`;
    };
    const onDrop = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<ExplorerTableReferenceDropDetail>;
      hideCaret();
      if (!ownsPoint(event.detail.clientX, event.detail.clientY)) return;
      const position =
        editorPositionAt(event.detail.clientX, event.detail.clientY) ??
        mountedEditor.getPosition?.();
      if (!position) return;
      const text = explorerTableReferenceInsertText(event.detail.payload);
      if (!text) return;
      mountedEditor.pushUndoStop?.();
      mountedEditor.executeEdits("oxide.explorer-table-drop", [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
          text,
          forceMoveMarkers: true,
        },
      ]);
      mountedEditor.pushUndoStop?.();
      mountedEditor.setPosition({
        lineNumber: position.lineNumber,
        column: position.column + text.length,
      });
      mountedEditor.focus();
    };
    const onDragEnd = () => hideCaret();
    window.addEventListener(OXIDE_TABLE_REFERENCE_HOVER_EVENT, onHover);
    window.addEventListener(OXIDE_TABLE_REFERENCE_DROP_EVENT, onDrop);
    window.addEventListener(OXIDE_TABLE_REFERENCE_DRAG_END_EVENT, onDragEnd);
    return () => {
      window.removeEventListener(OXIDE_TABLE_REFERENCE_HOVER_EVENT, onHover);
      window.removeEventListener(OXIDE_TABLE_REFERENCE_DROP_EVENT, onDrop);
      window.removeEventListener(
        OXIDE_TABLE_REFERENCE_DRAG_END_EVENT,
        onDragEnd,
      );
    };
  }, [canAcceptExplorerTableDrop, mountedEditor]);
}
