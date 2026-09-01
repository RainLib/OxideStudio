import { describe, expect, it } from "vitest";
import {
  cachedCurrentStatementRangeAtOffset,
  currentStatementLineFrames,
  MAX_CURRENT_STATEMENT_FRAME_LINES,
} from "./currentStatementDecoration";

describe("current statement range cache", () => {
  const cache = {
    modelVersion: 7,
    ranges: [
      { startOffset: 10, endOffset: 24 },
      { startOffset: 30, endOffset: 40 },
    ],
  };

  it("reuses authoritative ranges across the whole model version", () => {
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 10)).toBe(cache.ranges[0]);
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 23)).toBe(cache.ranges[0]);
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 31)).toBe(cache.ranges[1]);
  });

  it("uses backend-compatible whitespace fallback but re-resolves exact ends", () => {
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 9)).toBe(cache.ranges[0]);
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 25)).toBe(cache.ranges[1]);
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 41)).toBe(cache.ranges[1]);
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 24)).toBeNull();
    expect(cachedCurrentStatementRangeAtOffset(cache, 7, 40)).toBeNull();
  });

  it("invalidates after an edit", () => {
    expect(cachedCurrentStatementRangeAtOffset(cache, 8, 12)).toBeNull();
  });

  it("rejects empty or reversed ranges", () => {
    expect(
      cachedCurrentStatementRangeAtOffset(
        {
          modelVersion: 7,
          ranges: [{ startOffset: 10, endOffset: 10 }],
        },
        7,
        10,
      ),
    ).toBeNull();
  });

  it("skips statement frames above the logical-line cap", () => {
    const model = {
      getPositionAt: (offset: number) => ({ lineNumber: offset + 1 }),
    };
    expect(
      currentStatementLineFrames(model, 0, MAX_CURRENT_STATEMENT_FRAME_LINES + 2),
    ).toEqual([]);
    expect(
      currentStatementLineFrames(model, 0, MAX_CURRENT_STATEMENT_FRAME_LINES + 1),
    ).toHaveLength(MAX_CURRENT_STATEMENT_FRAME_LINES + 1);
  });
});
