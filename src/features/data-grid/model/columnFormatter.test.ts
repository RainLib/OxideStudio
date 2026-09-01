import { describe, expect, it } from "vitest";
import {
  applyColumnFormatter,
  columnFormatterKeys,
  normalizeColumnFormatter,
  normalizeColumnFormatterRecord,
} from "./columnFormatter";

describe("column formatter keys", () => {
  it("shares MySQL table and query keys without cross-database leakage", () => {
    const keys = columnFormatterKeys({
      connectionId: "conn",
      database: "app",
      schema: "app",
      databaseType: "mysql",
      resultColumn: "createdAt",
      displaySource: {
        database: "app",
        schema: "app",
        tableName: "users",
        sourceColumn: "created_at",
      },
    });
    expect(keys[0]).toBe("conn::app::::users::created_at");
    expect(keys).toContain("conn::app::app::users::created_at");
    expect(keys.every((key) => key.endsWith("::created_at"))).toBe(true);
  });

  it("uses the exact physical source and fails closed without a table", () => {
    expect(
      columnFormatterKeys({
        connectionId: "conn",
        database: "analytics",
        databaseType: "postgres",
        resultColumn: "createdAt",
        displaySource: {
          database: "analytics",
          schema: "audit",
          tableName: "events",
          sourceColumn: "created_at",
        },
      }),
    ).toEqual(["conn::analytics::audit::events::created_at"]);
    expect(
      columnFormatterKeys({
        connectionId: "conn",
        resultColumn: "total",
        displaySource: { sourceColumn: "total" },
      }),
    ).toEqual([]);
  });
});

describe("column formatter normalization and rendering", () => {
  it("normalizes supported configs and rejects malformed persisted input", () => {
    expect(
      normalizeColumnFormatter({
        kind: "datetime",
        unit: "milliseconds",
        pattern: "YYYY-MM-DD HH:mm:ss",
        timezone: "UTC",
      }),
    ).toMatchObject({ kind: "datetime", timezone: "UTC" });
    expect(
      normalizeColumnFormatter({ kind: "json-path", path: "$.user.name" }),
    ).toEqual({ kind: "json-path", path: "$.user.name" });
    expect(
      normalizeColumnFormatter({ kind: "custom-template", template: "raw" }),
    ).toBeUndefined();
    expect(
      normalizeColumnFormatterRecord({
        valid: { kind: "mask", prefix: 2, suffix: 2 },
        invalid: { kind: "mask", prefix: -1, suffix: 2 },
      }),
    ).toEqual({ valid: { kind: "mask", prefix: 2, suffix: 2 } });
  });

  it("formats dates, JSON paths, masks and templates without changing raw data", () => {
    const raw = "2026-09-01T08:09:10.123Z";
    expect(
      applyColumnFormatter(raw, {
        kind: "datetime",
        unit: "auto",
        pattern: "YYYY-MM-DD HH:mm:ss.SSS",
        timezone: "UTC",
      }),
    ).toBe("2026-09-01 08:09:10.123");
    expect(
      applyColumnFormatter('{"user":{"name":"Ada"}}', {
        kind: "json-path",
        path: "$.user.name",
      }),
    ).toBe("Ada");
    expect(
      applyColumnFormatter("1234567890", {
        kind: "mask",
        prefix: 2,
        suffix: 2,
      }),
    ).toBe("12••••••90");
    expect(
      applyColumnFormatter("active", {
        kind: "custom-template",
        template: "status=${value}",
      }),
    ).toBe("status=active");
    expect(raw).toBe("2026-09-01T08:09:10.123Z");
  });
});
