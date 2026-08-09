import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { buildQueryEditorOptions } from "./editorOptions";

describe("query editor completion options", () => {
  it("disables every automatic Monaco entry point in manual mode", () => {
    const options = buildQueryEditorOptions(
      {
        ...DEFAULT_APP_SETTINGS.editor,
        sqlCompletion: {
          ...DEFAULT_APP_SETTINGS.editor.sqlCompletion,
          triggerMode: "manual",
        },
      },
      false,
    );
    expect(options.quickSuggestions).toBe(false);
    expect(options.suggestOnTriggerCharacters).toBe(false);
  });

  it("keeps automatic suggestions out of comments and strings", () => {
    const options = buildQueryEditorOptions(DEFAULT_APP_SETTINGS.editor, false);
    expect(options.quickSuggestions).toEqual({
      other: true,
      comments: false,
      strings: false,
    });
  });
});
