import { describe, expect, it } from "vitest";
import { editorSaveTargetTooltip } from "./editorSaveTarget";

describe("editor save target tooltip", () => {
  it("identifies an external/project file as the original file", () => {
    expect(editorSaveTargetTooltip("original-file", true)).toBe(
      "Save to Original File (Ctrl+S)",
    );
    expect(editorSaveTargetTooltip("original-file", false)).toBe(
      "Original File Saved",
    );
  });

  it("identifies a saved query as an SQL Library item", () => {
    expect(editorSaveTargetTooltip("sql-library", true)).toBe(
      "Save to SQL Library (Ctrl+S)",
    );
    expect(editorSaveTargetTooltip("sql-library", false)).toBe(
      "SQL Library Item Saved",
    );
  });
});
