export const QUERY_EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 16,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  padding: { top: 24, bottom: 16 },
  lineNumbers: "on",
  renderLineHighlight: "all",
  smoothScrolling: true,
  cursorBlinking: "smooth",
  quickSuggestions: { other: true, comments: true, strings: true },
  suggestOnTriggerCharacters: true,
  // SQL semantic suggestions come from the LSP; Monaco word suggestions can
  // surface column-like tokens in relation-target contexts.
  wordBasedSuggestions: "off",
  acceptSuggestionOnCommitCharacter: false,
} as const;
