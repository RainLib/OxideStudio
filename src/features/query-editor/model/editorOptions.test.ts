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
    expect(options.tabCompletion).toBe("off");
  });

  it("keeps automatic suggestions out of comments and strings", () => {
    const options = buildQueryEditorOptions(DEFAULT_APP_SETTINGS.editor, false);
    expect(options.quickSuggestions).toEqual({
      other: true,
      comments: false,
      strings: false,
    });
    expect(options.tabCompletion).toBe("on");
  });

  it.each(["positional", "require-prefix"] as const)(
    "waits for pending %s completions before falling back to a normal Tab",
    (triggerMode) => {
      const options = buildQueryEditorOptions(
        {
          ...DEFAULT_APP_SETTINGS.editor,
          sqlCompletion: {
            ...DEFAULT_APP_SETTINGS.editor.sqlCompletion,
            triggerMode,
          },
        },
        false,
      );

      expect(options.tabCompletion).toBe("on");
    },
  );
});
