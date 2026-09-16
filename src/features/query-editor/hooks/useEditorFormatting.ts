import {
  elasticsearchRequestsForSelection,
  formatElasticsearchConsole,
} from "@/lib/elasticsearchConsole";

interface EditorFormattingOptions {
  editorRef: React.RefObject<any>;
  isElasticsearchConsole: boolean;
}

export function useEditorFormatting({
  editorRef,
  isElasticsearchConsole,
}: EditorFormattingOptions) {
  const handleFormat = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    if (!isElasticsearchConsole) {
      editor.getAction("editor.action.formatDocument").run();
      return;
    }

    const selection = editor.getSelection();
    const cursor = editor.getPosition();
    if (!selection && !cursor) return;
    const selectionStart = selection
      ? model.getOffsetAt({
          lineNumber: selection.startLineNumber,
          column: selection.startColumn,
        })
      : model.getOffsetAt(cursor);
    const selectionEnd =
      selection && !selection.isEmpty()
        ? model.getOffsetAt({
            lineNumber: selection.endLineNumber,
            column: selection.endColumn,
          })
        : selectionStart;
    const requests = elasticsearchRequestsForSelection(
      model.getValue(),
      selectionStart,
      selectionEnd,
    );
    if (requests.length === 0) return;

    const startOffset = requests[0]!.startOffset;
    const endOffset = requests[requests.length - 1]!.endOffset;
    const source = model.getValue().slice(startOffset, endOffset);
    const formatted = formatElasticsearchConsole(source);
    if (!formatted || formatted === source) return;
    const start = model.getPositionAt(startOffset);
    const end = model.getPositionAt(endOffset);
    editor.executeEdits("oxide.elasticsearch.format", [
      {
        range: {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        },
        text: formatted,
        forceMoveMarkers: true,
      },
    ]);
  };

  return { handleFormat };
}
