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

  it("uses a generation guard even when the model version is unchanged", () => {
    const model = { getVersionId: () => 4 };
    expect(
      isCompletionRequestCurrent({
        model,
        modelVersion: 4,
        currentGeneration: 8,
        requestGeneration: 7,
      }),
    ).toBe(false);
  });
});
