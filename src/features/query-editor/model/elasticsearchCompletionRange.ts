/**
 * Monaco replacement range for a JSON string member. It consumes the matching
 * closing quote when present, so field completion in `"field"` does not leave
 * a duplicate quote behind. This is shared provider model logic rather than
 * view state.
 */
export function elasticsearchJsonStringCompletionRange(
  monaco: any,
  model: any,
  position: any,
) {
  const lineBeforeCursor = model
    .getLineContent(position.lineNumber)
    .slice(0, position.column - 1);
  const lineAfterCursor = model
    .getLineContent(position.lineNumber)
    .slice(position.column - 1);
  const stringFragment = lineBeforeCursor.match(/"[\w.@*-]*$/u)?.[0];
  if (stringFragment) {
    return new monaco.Range(
      position.lineNumber,
      lineBeforeCursor.length - stringFragment.length + 1,
      position.lineNumber,
      lineAfterCursor.startsWith('"')
        ? position.column + 1
        : position.column,
    );
  }

  const word = model.getWordUntilPosition(position);
  return new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
}
