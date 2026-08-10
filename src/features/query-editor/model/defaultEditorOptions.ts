export const QUERY_EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  fontLigatures: true,
  lineHeight: 20,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 4, bottom: 16 },
  lineNumbers: "on",
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  rulers: [120] as number[],
  renderLineHighlight: "all",
  renderWhitespace: "selection",
  // Keep Monaco's native Cut/Copy/Paste actions available. They already use
  // the editor undo stack, multi-cursor selections, read-only gates and host
  // clipboard permissions, so a second custom context menu would diverge.
  contextmenu: true,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
  quickSuggestions: { other: true, comments: true, strings: true },
  suggestOnTriggerCharacters: true,
  // SQL semantic suggestions come from the LSP; Monaco word suggestions can
  // surface column-like tokens in relation-target contexts.
  wordBasedSuggestions: "off",
  acceptSuggestionOnCommitCharacter: false,
} as const;
