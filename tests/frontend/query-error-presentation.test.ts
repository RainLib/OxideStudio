import { describe, expect, it } from "vitest";
import {
  isMissingConnectionSession,
  presentQueryError,
} from "@/lib/queryErrorPresentation";
import { ApiError } from "@/services/tauri";

describe("query error presentation", () => {
  it("recognizes both legacy and structured missing-session failures", () => {
    expect(
      isMissingConnectionSession(
        new Error("Connection not found: internal-connection-id"),
      ),
    ).toBe(true);
    expect(
      isMissingConnectionSession(
        new ApiError(
          "The live connection session is not active.",
          "CONNECTION_SESSION_NOT_FOUND",
        ),
      ),
    ).toBe(true);
  });

  it("explains a stale connection without making the UUID the primary error", () => {
    const presentation = presentQueryError(
      "Connection not found: internal-connection-id",
      "Search Production",
    );

    expect(presentation.title).toBe("Data source session expired");
    expect(presentation.description).toContain("Search Production");
    expect(presentation.description).not.toContain("internal-connection-id");
    expect(presentation.suggestion).toContain("reconnect automatically");
    expect(presentation.technicalDetails).toContain("internal-connection-id");
  });
});
