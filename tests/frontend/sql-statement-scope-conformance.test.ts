import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/sql-statement-scope.json";
import { sqlStatementBeforeCursor } from "@/lib/queryEditorCachedCompletion";

type StatementScopeFixture = {
  id: string;
  beforeCursor: string;
  frontendCurrent: string;
};

describe("SQL statement scope conformance", () => {
  it.each(fixtures as StatementScopeFixture[])(
    "$id uses the same completion scope as the cursor contract",
    ({ beforeCursor, frontendCurrent }) => {
      expect(sqlStatementBeforeCursor(beforeCursor)).toBe(frontendCurrent);
    },
  );
});
