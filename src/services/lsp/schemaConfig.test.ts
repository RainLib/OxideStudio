import { describe, expect, it } from "vitest";
import type { ColumnInfo } from "@/services/tauri";
import { classifyLspColumnOwnership } from "./schemaConfig";

const column = (overrides: Partial<ColumnInfo> = {}): ColumnInfo => ({
  name: "total",
  data_type: "numeric",
  is_nullable: false,
  is_primary_key: false,
  ...overrides,
});

describe("LSP column ownership classification", () => {
  it("prefers structured generated and hidden metadata", () => {
    expect(
      classifyLspColumnOwnership(
        column({ is_generated: false, is_hidden: true }),
        {
          hasExactGeneratedColumnFallback: true,
          generatedColumnNames: new Set(["total"]),
        }
      )
    ).toEqual({ generated: false, hidden: true });
  });

  it("retains exact legacy generated-column discovery", () => {
    expect(
      classifyLspColumnOwnership(column(), {
        hasExactGeneratedColumnFallback: true,
        generatedColumnNames: new Set(["total"]),
      })
    ).toEqual({ generated: true, hidden: false });
  });

  it("fails closed for missing or failed ownership metadata", () => {
    expect(
      classifyLspColumnOwnership(column(), {
        hasExactGeneratedColumnFallback: false,
        generatedColumnNames: new Set(),
      })
    ).toEqual({ generated: true, hidden: false });
    expect(
      classifyLspColumnOwnership(column(), {
        hasExactGeneratedColumnFallback: true,
        generatedColumnNames: null,
      })
    ).toEqual({ generated: true, hidden: false });
  });
});
