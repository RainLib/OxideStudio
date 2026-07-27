import { describe, expect, it } from "vitest";
import {
  applyLineDiffHunk,
  createLineDiffHunks,
  lineDiffCounts,
} from "@/lib/lineDiff";

describe("line diff review", () => {
  it("keeps separate changes as separate review hunks", () => {
    const original = "one\ntwo\nthree\nfour\nfive\n";
    const proposed = "one\nTWO\nthree\nfour\nFIVE\nsix\n";
    const hunks = createLineDiffHunks(original, proposed);

    expect(hunks).toHaveLength(2);
    expect(lineDiffCounts(original, proposed)).toEqual({
      additions: 3,
      deletions: 2,
    });
  });

  it("accepts one hunk without accepting the remaining proposal", () => {
    const original = "one\ntwo\nthree\nfour\n";
    const proposed = "one\nTWO\nthree\nFOUR\n";
    const [first] = createLineDiffHunks(original, proposed);

    const partiallyAccepted = applyLineDiffHunk(
      original,
      proposed,
      first!,
      "accept",
    );
    expect(partiallyAccepted).toBe("one\nTWO\nthree\nfour\n");
    expect(createLineDiffHunks(partiallyAccepted, proposed)).toHaveLength(1);
  });

  it("rejects one hunk without changing the original file", () => {
    const original = "one\ntwo\nthree\nfour\n";
    const proposed = "one\nTWO\nthree\nFOUR\n";
    const [first] = createLineDiffHunks(original, proposed);

    const remainingProposal = applyLineDiffHunk(
      original,
      proposed,
      first!,
      "reject",
    );
    expect(remainingProposal).toBe("one\ntwo\nthree\nFOUR\n");
    expect(original).toBe("one\ntwo\nthree\nfour\n");
  });

  it("handles a newly proposed file without a phantom deleted line", () => {
    expect(lineDiffCounts("", "select 1;\nselect 2;\n")).toEqual({
      additions: 2,
      deletions: 0,
    });
  });
});
