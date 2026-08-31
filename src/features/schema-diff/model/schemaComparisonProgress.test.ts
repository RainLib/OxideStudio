import { describe, expect, it } from "vitest";
import {
  schemaComparisonNextPhase,
  schemaComparisonPhaseLabel,
} from "./schemaComparisonProgress";

describe("schema comparison progress", () => {
  it("uses real capture, comparison, and review milestones in order", () => {
    expect(schemaComparisonPhaseLabel("capture-target")).toBe(
      "Reading live target metadata",
    );
    expect(schemaComparisonNextPhase("capture-target")).toBe(
      "compare-snapshots",
    );
    expect(schemaComparisonNextPhase("compare-snapshots")).toBe("open-review");
    expect(schemaComparisonNextPhase("open-review")).toBeNull();
  });
});
