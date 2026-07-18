import { describe, expect, it } from "vitest";
import { presentAssistantError } from "@/ai/assistant/errorPresentation";

describe("assistant error presentation", () => {
  it("turns MongoDB command-shape failures into an actionable message", () => {
    expect(
      presentAssistantError({
        code: "TOOL_ERROR",
        message: "Invalid MongoDB command shape",
      }),
    ).toEqual({
      message:
        "I couldn't translate that request into a valid read-only MongoDB query. Nothing was changed. Please retry the step.",
      detail: "TOOL_ERROR: Invalid MongoDB command shape",
    });
  });

  it("redacts provider credentials from technical details", () => {
    const result = presentAssistantError({
      message:
        "HTTP 401 from https://user:super-secret@example.com/v1/chat/completions",
    });

    expect(result.message).toContain("rejected the configured credentials");
    expect(result.detail).toContain("user:****@example.com");
    expect(result.detail).not.toContain("super-secret");
  });

  it("explains resumable timeouts without runtime jargon", () => {
    expect(
      presentAssistantError({
        code: "MODEL_TIMEOUT",
        message: "request deadline exceeded",
        retryable: true,
      }).message,
    ).toBe(
      "The request took too long. You can resume it without starting over.",
    );
  });
});
