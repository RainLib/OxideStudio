import { describe, expect, it } from "vitest";
import { mergeCompletionFallbackSuggestions } from "./completionFallback";

describe("mergeCompletionFallbackSuggestions", () => {
  it("keeps function overloads with distinct signatures", () => {
    expect(
      mergeCompletionFallbackSuggestions(
        [
          { label: "round", detail: "round(value numeric)" },
          { label: "round", detail: "round(value numeric, scale integer)" },
        ],
        [],
      ),
    ).toHaveLength(2);
  });

  it("lets a semantic proposal suppress a same-label fallback", () => {
    expect(
      mergeCompletionFallbackSuggestions(
        [{ label: "SELECT", detail: "Language server keyword" }],
        [{ label: "SELECT", detail: "SQL syntax" }],
      ),
    ).toEqual([{ label: "SELECT", detail: "Language server keyword" }]);
  });

  it("preserves overloads when they arrive in the secondary merge input", () => {
    expect(
      mergeCompletionFallbackSuggestions(
        [{ label: "JOIN", detail: "Smart foreign-key join" }],
        [
          { label: "date_trunc", detail: "date_trunc(text, timestamp)" },
          { label: "date_trunc", detail: "date_trunc(text, interval)" },
        ],
      ).filter((item) => item.label === "date_trunc"),
    ).toHaveLength(2);
  });
});
