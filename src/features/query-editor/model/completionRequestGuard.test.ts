import { describe, expect, it } from "vitest";
import { isCompletionRequestCurrent } from "./completionRequestGuard";

describe("isCompletionRequestCurrent", () => {
  it("rejects cancelled, changed-model, and superseded metadata completions", () => {
    const model = { getVersionId: () => 4 };
    expect(isCompletionRequestCurrent({ model, modelVersion: 4 })).toBe(true);
    expect(isCompletionRequestCurrent({ model, modelVersion: 3 })).toBe(false);
    expect(isCompletionRequestCurrent({ model, modelVersion: 4, token: { isCancellationRequested: true } })).toBe(false);
    expect(isCompletionRequestCurrent({ model, modelVersion: 4, currentGeneration: 3, requestGeneration: 2 })).toBe(false);
  });
});
