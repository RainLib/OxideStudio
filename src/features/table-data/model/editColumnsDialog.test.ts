import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import {
  createAlterColumnDraft,
  createDefaultColumnDraft,
  formatColumnFlags,
  lengthForColumnType,
  parseColumnDataType,
} from "@/features/table-data/model/editColumnsDialog";

const capabilities = defaultDatabaseCapabilities("postgres");

describe("editColumnsDialog model", () => {
  it("builds an empty draft from the active dialect defaults", () => {
    expect(createDefaultColumnDraft(capabilities)).toMatchObject({
      name: "",
      type: "VARCHAR",
      length: "255",
      isPrimaryKey: false,
      isNotNull: false,
      isAutoIncrement: false,
      comment: "",
    });
  });

  it("normalizes compatible SQL type spellings and preserves declared length", () => {
    expect(parseColumnDataType("character varying( 48 )", capabilities)).toEqual({
      type: "VARCHAR",
      length: "48",
    });
    expect(parseColumnDataType("unknown_vendor_type", capabilities).type).toBe(
      capabilities.commonDataTypes[0],
    );
  });

  it("keeps current variable-length input while clearing lengths for fixed types", () => {
    expect(lengthForColumnType("VARCHAR", "96")).toBe("96");
    expect(lengthForColumnType("INTEGER", "96")).toBe("");
  });

  it("creates a reviewable alter draft and exposes all known column flags", () => {
    const column = {
      name: "account_id",
      data_type: "INTEGER",
      is_nullable: false,
      is_primary_key: true,
      is_unique: true,
      is_indexed: true,
      is_auto_increment: true,
      default_value: "nextval('accounts_id_seq')",
      comment: "stable identity",
    };

    expect(createAlterColumnDraft(column, capabilities)).toMatchObject({
      name: "account_id",
      isNotNull: true,
      originalIsNotNull: true,
      defaultMode: "keep",
      defaultValue: "nextval('accounts_id_seq')",
      commentMode: "keep",
      comment: "stable identity",
    });
    expect(formatColumnFlags(column)).toEqual(["PK", "NN", "UQ", "IDX", "AI"]);
  });
});
