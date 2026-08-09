import { describe, expect, it } from "vitest";
import { cachedCurrentStatementRangeAtOffset } from "./currentStatementDecoration";

describe("current statement range cache", () => {
  const cache = {
    modelVersion: 7,
    startOffset: 10,
    endOffset: 24,
  };

  it("reuses an authoritative range while the cursor stays inside it", () => {
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 10)).toBe(cache);
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 23)).toBe(cache);
  });

  it("invalidates on edits and statement boundaries", () => {
    expect(cachedCurrentStatementRangeAtOffset(cache, 8, 12)).toBeNull();
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 9)).toBeNull();
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 24)).toBeNull();
  });

  it("rejects empty or reversed ranges", () => {
    expect(
      cachedCurrentStatementRangeAtOffset(
        { modelVersion: 7, startOffset: 10, endOffset: 10 },
        7,
        10,
      ),
    ).toBeNull();
  });
});
