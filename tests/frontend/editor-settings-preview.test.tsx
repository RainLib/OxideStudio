import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditorSettingsPreview, buildEditorSettingsPreviewLines } from "@/components/settings/EditorSettingsPreview";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";

describe("editor settings live preview", () => {
  it("reflects SQL casing and layout without an editor runtime", () => {
    const lines = buildEditorSettingsPreviewLines({
      keywordCase: "lower",
      functionCase: "lower",
      logicalOperatorNewline: "none",
      fromClauseLayout: "sameLine",
    });
    const text = lines.map((line) => line.map((part) => part.text).join("")).join("\n");

    expect(text).toContain("select u.id, count(o.id) as order_count from users u");
    expect(text).toContain("where u.active = TRUE and o.created_at >= CURRENT_DATE");
    expect(text).not.toContain("\nfrom users u");
  });

  it("renders minimap, wrapping, font size and relative line numbers from settings", () => {
    const editor = {
      ...DEFAULT_APP_SETTINGS.editor,
      fontSize: 17,
      tabSize: 2,
      wordWrap: "bounded" as const,
      minimap: true,
      keybindingMode: "vim" as const,
      vim: {
        ...DEFAULT_APP_SETTINGS.editor.vim,
        relativeLineNumbers: true,
      },
    };

    const markup = renderToStaticMarkup(<EditorSettingsPreview editor={editor} />);

    expect(markup).toContain('aria-label="SQL editor live preview"');
    expect(markup).toContain('data-minimap="visible"');
    expect(markup).toContain('data-word-wrap="bounded"');
    expect(markup).toContain("font-size:17px");
    expect(markup).toContain("tab-size:2");
    expect(markup).toContain("data-editor-preview-minimap");
    expect(markup).toMatch(/>0<\/span>/u);
  });
});
