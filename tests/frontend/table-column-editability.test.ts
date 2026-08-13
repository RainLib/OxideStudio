import { describe, expect, it } from "vitest";
import {
  isTableColumnEditable,
  tableColumnEditability,
  tableColumnReadOnlyReason,
} from "@/features/data-grid";

describe("table column editability", () => {
  it("keeps only classified ordinary columns editable", () => {
    expect(tableColumnEditability(undefined)).toBe("unclassified");
    expect(tableColumnEditability({ is_generated: false, is_hidden: false })).toBe("editable");
    expect(isTableColumnEditable({})).toBe(false);
  });

  it("blocks generated and hidden database-owned columns", () => {
    expect(tableColumnEditability({ is_generated: true })).toBe("generated");
    expect(tableColumnEditability({ is_hidden: true })).toBe("hidden");
    expect(tableColumnReadOnlyReason(tableColumnEditability({ is_generated: true }))).toBe("generated-column");
    expect(tableColumnReadOnlyReason(tableColumnEditability({ is_hidden: true }))).toBe("hidden-column");
    expect(tableColumnReadOnlyReason(tableColumnEditability({}))).toBe("unclassified-column");
    expect(isTableColumnEditable({ is_generated: true })).toBe(false);
    expect(isTableColumnEditable({ is_hidden: true })).toBe(false);
  });
});
