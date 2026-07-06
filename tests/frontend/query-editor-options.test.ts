import { describe, expect, it } from "vitest";
import { QUERY_EDITOR_OPTIONS } from "@/components/workspace/queryEditorOptions";

describe("query editor options", () => {
  it("keeps semantic SQL completion owned by the LSP provider", () => {
    expect(QUERY_EDITOR_OPTIONS.wordBasedSuggestions).toBe("off");
    expect(QUERY_EDITOR_OPTIONS.suggestOnTriggerCharacters).toBe(true);
    expect(QUERY_EDITOR_OPTIONS.quickSuggestions.other).toBe(true);
  });
});
