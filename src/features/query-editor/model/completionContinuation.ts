/** Monaco does not automatically treat accepted programmatic edits as typed
 * trigger characters. Defer until the edit/snippet has placed the caret. */
export function triggerChainedSqlCompletion(
  editor: any,
  origin: { current: "explicit" | "chained" | null },
) {
  const model = editor?.getModel();
  if (!editor || !model) return;
  window.setTimeout(() => {
    if (editor.getModel() !== model || !editor.hasTextFocus()) return;
    origin.current = "chained";
    editor.trigger("oxide.sql.chainedCompletion", "editor.action.triggerSuggest", {});
    window.setTimeout(() => {
      if (origin.current === "chained") origin.current = null;
    }, 0);
  }, 0);
}
