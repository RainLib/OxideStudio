import { describe, expect, it } from "vitest";
import { buildQueryEditorOptions } from "@/features/query-editor";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";

describe("query editor options model", () => {
  it("derives Monaco options solely from editor settings and query language", () => {
    const standard = buildQueryEditorOptions(
      DEFAULT_APP_SETTINGS.editor,
      false,
    );
    const vim = buildQueryEditorOptions(
      {
        ...DEFAULT_APP_SETTINGS.editor,
        fontSize: 15,
        minimap: true,
        inlineCompletion: {
          ...DEFAULT_APP_SETTINGS.editor.inlineCompletion,
          enabled: true,
        },
        keybindingMode: "vim",
        vim: {
          ...DEFAULT_APP_SETTINGS.editor.vim,
          relativeLineNumbers: true,
        },
      },
      true,
    );

    expect(standard).toMatchObject({
      glyphMargin: false,
      lineNumbers: "on",
      wordBasedSuggestions: "off",
    });
    expect(vim).toMatchObject({
      fontSize: 15,
      minimap: { enabled: true },
      inlineSuggest: { enabled: true },
      glyphMargin: true,
      lineNumbers: "relative",
    });
  });
});
