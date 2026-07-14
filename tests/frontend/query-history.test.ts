import { describe, expect, it } from "vitest";
import {
  queryHistoryRowCount,
  queryHistoryStatusFromError,
} from "@/lib/queryHistory";

describe("query history helpers", () => {
  it("counts selected and affected rows across statements", () => {
    expect(
      queryHistoryRowCount([
        { rows: [[1], [2]] },
        { rows: [], rowsAffected: 3 },
      ])
    ).toBe(5);
  });

  it("distinguishes cancellation from execution errors", () => {
    expect(queryHistoryStatusFromError("Query cancelled by user")).toBe(
      "cancelled"
    );
    expect(queryHistoryStatusFromError("syntax error")).toBe("error");
  });
});
