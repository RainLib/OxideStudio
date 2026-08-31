import type { CSSProperties } from "react";
import type { AppSettings, SqlFormattingSettings } from "@/lib/appSettings";
import { QUERY_EDITOR_OPTIONS } from "@/features/query-editor/model/defaultEditorOptions";
import { cn } from "@/lib/utils";

type PreviewTokenKind = "plain" | "keyword" | "function" | "literal" | "comment";

export type EditorSettingsPreviewToken = {
  kind: PreviewTokenKind;
  text: string;
};

export type EditorSettingsPreviewLine = readonly EditorSettingsPreviewToken[];

function casedSqlToken(
  value: string,
  preference: "upper" | "lower" | "preserve",
): string {
  // SQL keyword casing must stay locale-independent (for example in a
  // Turkish UI locale where locale-aware `i` casing differs).
  if (preference === "lower") return value.toLowerCase();
  if (preference === "upper") return value.toUpperCase();
  return value;
}

const token = (kind: PreviewTokenKind, text: string): EditorSettingsPreviewToken => ({
  kind,
  text,
});

/**
 * Builds a stable, data-free SQL sample for the settings preview. Keeping the
 * formatter pure makes every visible setting deterministic without opening a
 * Monaco model, registering providers, or contacting a database.
 */
export function buildEditorSettingsPreviewLines(
  formatting: SqlFormattingSettings,
): EditorSettingsPreviewLine[] {
  const keyword = (value: string) =>
    token("keyword", casedSqlToken(value, formatting.keywordCase));
  const sqlFunction = (value: string) =>
    token("function", casedSqlToken(value, formatting.functionCase));
  const select: EditorSettingsPreviewToken[] = [
    keyword("SELECT"),
    token("plain", " u.id, "),
    sqlFunction("COUNT"),
    token("plain", "(o.id) "),
    keyword("AS"),
    token("plain", " order_count"),
  ];
  const from: EditorSettingsPreviewToken[] = [
    keyword("FROM"),
    token("plain", " users u"),
  ];
  const lines: EditorSettingsPreviewLine[] = [];

  if (formatting.fromClauseLayout === "sameLine") {
    lines.push([...select, token("plain", " "), ...from]);
  } else {
    lines.push(select, from);
  }

  lines.push([
    keyword("LEFT JOIN"),
    token("plain", " orders o "),
    keyword("ON"),
    token("plain", " o.user_id = u.id"),
  ]);

  const where = [
    keyword("WHERE"),
    token("plain", " u.active = "),
    token("literal", "TRUE"),
  ];
  const datePredicate = [
    token("plain", "o.created_at >= "),
    token("literal", "CURRENT_DATE"),
  ];
  if (formatting.logicalOperatorNewline === "before") {
    lines.push(where, [token("plain", "  "), keyword("AND"), token("plain", " "), ...datePredicate]);
  } else if (formatting.logicalOperatorNewline === "after") {
    lines.push([...where, token("plain", " "), keyword("AND")], [token("plain", "  "), ...datePredicate]);
  } else {
    lines.push([...where, token("plain", " "), keyword("AND"), token("plain", " "), ...datePredicate]);
  }

  lines.push(
    [keyword("GROUP BY"), token("plain", " u.id")],
    [keyword("ORDER BY"), token("plain", " order_count "), keyword("DESC"), token("plain", ";")],
    [token("comment", "-- Settings update this preview immediately")],
  );
  return lines;
}

const TOKEN_CLASS: Record<PreviewTokenKind, string> = {
  plain: "text-[hsl(var(--wb-text))]",
  keyword: "font-medium text-[hsl(var(--wb-accent))]",
  function: "text-[hsl(var(--wb-brand))]",
  literal: "text-[hsl(var(--wb-brand))]",
  comment: "italic text-[hsl(var(--wb-text-muted))]",
};

function editorPreviewLineNumber(
  index: number,
  activeLineIndex: number,
  relative: boolean,
): number {
  return relative ? Math.abs(index - activeLineIndex) : index + 1;
}

export function EditorSettingsPreview({
  editor,
}: {
  editor: AppSettings["editor"];
}) {
  const lines = buildEditorSettingsPreviewLines(editor.sqlFormatting);
  const activeLineIndex = Math.min(1, lines.length - 1);
  const relativeLineNumbers =
    editor.keybindingMode === "vim" && editor.vim.relativeLineNumbers;
  const wraps = editor.wordWrap !== "off";
  const showsColumnRuler =
    editor.wordWrap === "wordWrapColumn" || editor.wordWrap === "bounded";
  const codeStyle: CSSProperties = {
    fontFamily: QUERY_EDITOR_OPTIONS.fontFamily,
    fontSize: `${editor.fontSize}px`,
    lineHeight: `${Math.max(editor.fontSize + 7, 20)}px`,
    tabSize: editor.tabSize,
  };

  return (
    <section
      aria-label="SQL editor live preview"
      className="w-full max-w-[820px]"
      data-editor-settings-preview
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-semibold text-[hsl(var(--wb-text))]">
          Live preview
        </span>
        <span className="truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
          {editor.fontSize}px · tab {editor.tabSize} · {editor.wordWrap === "off" ? "no wrap" : "wrap"}
        </span>
      </div>
      <div
        className="relative max-h-[168px] min-h-[112px] overflow-y-auto rounded-[5px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] shadow-[inset_0_1px_0_hsl(var(--wb-border-subtle)/0.45)]"
        data-minimap={editor.minimap ? "visible" : "hidden"}
        data-word-wrap={editor.wordWrap}
        style={{ overflowX: wraps ? "hidden" : "auto" }}
      >
        {showsColumnRuler && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-[76%] border-l border-[hsl(var(--wb-border-subtle)/0.65)]"
          />
        )}
        <div
          className={cn("min-w-max py-2", editor.minimap ? "pr-16" : "pr-3", wraps && "min-w-0")}
          style={codeStyle}
        >
          {lines.map((line, index) => (
            <div
              className={cn(
                "flex min-w-0 px-2",
                index === activeLineIndex && "bg-[hsl(var(--wb-active)/0.45)]",
              )}
              key={`${index}-${line.map((part) => part.text).join("")}`}
            >
              <span
                aria-hidden="true"
                className="mr-3 w-6 shrink-0 select-none text-right text-[hsl(var(--wb-text-muted)/0.72)]"
              >
                {editorPreviewLineNumber(index, activeLineIndex, relativeLineNumbers)}
              </span>
              <code className={cn("min-w-0", wraps ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
                {line.map((part, partIndex) => (
                  <span className={TOKEN_CLASS[part.kind]} key={`${partIndex}-${part.text}`}>
                    {part.text}
                  </span>
                ))}
              </code>
            </div>
          ))}
        </div>
        {editor.minimap && (
          <div
            aria-hidden="true"
            className="absolute inset-y-0 right-0 w-12 border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)] px-1.5 py-2"
            data-editor-preview-minimap
          >
            {lines.map((line, index) => (
              <span
                className={cn(
                  "mb-1 block h-px max-w-full bg-[hsl(var(--wb-text-muted)/0.48)]",
                  index === activeLineIndex && "bg-[hsl(var(--wb-accent)/0.8)]",
                )}
                key={`minimap-${index}`}
                style={{ width: `${Math.min(100, 24 + line.reduce((length, part) => length + part.text.length, 0))}%` }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
