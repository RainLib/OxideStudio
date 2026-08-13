import { describe, expect, it } from "vitest";
import {
  binaryByteLength,
  formatJsonDraft,
  inferValueEditorKind,
  parseGeometryPreview,
  parseImagePreview,
  parseMapPreview,
  parseXmlPreview,
  parseJsonPreview,
  parseValueEditorDraft,
  valueEditorDraft,
  valueEditorState,
} from "@/lib/valueEditor";

describe("value editor model", () => {
  it("keeps unloaded, NULL, empty string, and value states distinct", () => {
    expect(valueEditorState(undefined)).toBe("unloaded");
    expect(valueEditorState(null)).toBe("null");
    expect(valueEditorState("")).toBe("empty");
    expect(valueEditorState("value")).toBe("value");
  });

  it("uses database column types before value-shape inference", () => {
    expect(inferValueEditorKind("jsonb", "{}")).toBe("json");
    expect(inferValueEditorKind("bytea", "\\x00ff")).toBe("binary");
    expect(
      inferValueEditorKind(
        "timestamp with time zone",
        "2026-07-15 10:00:00+08",
      ),
    ).toBe("date");
    expect(inferValueEditorKind("numeric(30, 10)", "9007199254740993")).toBe(
      "number",
    );
    expect(inferValueEditorKind("bigint", "9007199254740993")).toBe("number");
    expect(inferValueEditorKind("int8", "9007199254740993")).toBe("number");
    expect(inferValueEditorKind("hstore", '"role"=>"admin"')).toBe("map");
    expect(inferValueEditorKind("xml", "<role>admin</role>")).toBe("xml");
    expect(inferValueEditorKind("geometry", "POINT(1 2)")).toBe("geometry");
    expect(inferValueEditorKind("image", "data:image/png;base64,AA==")).toBe("image");
  });

  it("renders hstore and JSON maps as bounded read-only trees without rewriting drafts", () => {
    expect(parseMapPreview('"role"=>"admin", "enabled"=>NULL')).toEqual({
      ok: true,
      value: { role: "admin", enabled: null },
    });
    expect(parseMapPreview('{"role":"admin"}')).toEqual({
      ok: true,
      value: { role: "admin" },
    });
    expect(parseMapPreview('"role"=>"admin",')).toMatchObject({ ok: false });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: '"role"=>"admin"',
        kind: "map",
        nullable: false,
      }),
    ).toEqual({ ok: true, value: '"role"=>"admin"' });
  });

  it("renders XML as a bounded inspection tree without parsing dangerous declarations", () => {
    expect(parseXmlPreview('<role active="true"><name>admin</name></role>')).toEqual({
      ok: true,
      value: {
        role: {
          "@attributes": { active: "true" },
          children: [{ name: { children: [{ "#text": "admin" }] } }],
        },
      },
    });
    expect(parseXmlPreview("<!DOCTYPE role><role/>" )).toMatchObject({ ok: false });
    expect(parseXmlPreview("<role><name/></roleish>")).toMatchObject({ ok: false });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "<role>admin</role>",
        kind: "xml",
        nullable: false,
      }),
    ).toEqual({ ok: true, value: "<role>admin</role>" });
  });

  it("previews only inert raster images and summarized WKT geometry", () => {
    expect(parseImagePreview("data:image/png;base64,AA==")).toEqual({
      ok: true,
      dataUrl: "data:image/png;base64,AA==",
    });
    expect(parseImagePreview("data:image/svg+xml;base64,PHN2Zy8+")).toMatchObject({ ok: false });
    expect(parseGeometryPreview("SRID=4326;POINT(120.1 30.2)")).toEqual({
      ok: true,
      value: {
        type: "POINT",
        srid: "4326",
        empty: false,
        coordinateCount: 2,
        coordinates: ["120.1", "30.2"],
      },
    });
    expect(parseGeometryPreview("POINT(1 2")).toMatchObject({ ok: false });
  });

  it("pretty-prints and validates JSON without turning it into text", () => {
    expect(valueEditorDraft({ role: "admin" }, "json")).toBe(
      '{\n  "role": "admin"\n}',
    );
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: '{"role":"admin"}',
        kind: "json",
        nullable: true,
      }),
    ).toEqual({ ok: true, value: { role: "admin" } });
    expect(formatJsonDraft('{"role":"admin"}')).toEqual({
      ok: true,
      value: '{\n  "role": "admin"\n}',
    });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "{broken",
        kind: "json",
        nullable: true,
      }),
    ).toMatchObject({ ok: false });
  });

  it("parses bounded JSON only for the read-only tree preview", () => {
    expect(parseJsonPreview('{"role":"admin","tags":["a"]}')).toEqual({
      ok: true,
      value: { role: "admin", tags: ["a"] },
    });
    expect(parseJsonPreview("{broken")).toMatchObject({ ok: false });
    expect(parseJsonPreview("x".repeat(1_000_001))).toEqual({
      ok: false,
      error: "JSON is too large for the tree preview. Use the text view instead.",
    });
  });

  it("validates binary hex and reports byte length", () => {
    expect(binaryByteLength("\\x007f80ff")).toBe(4);
    expect(binaryByteLength("0x00ff")).toBe(2);
    expect(binaryByteLength("0x0")).toBeNull();
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "0x00ff",
        kind: "binary",
        nullable: false,
      }),
    ).toEqual({ ok: true, value: "0x00ff" });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "0x0",
        kind: "binary",
        nullable: false,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("byte pairs"),
    });
  });

  it("enforces nullable and unloaded states without guessing", () => {
    expect(
      parseValueEditorDraft({
        state: "null",
        draft: "",
        kind: "text",
        nullable: false,
      }),
    ).toEqual({ ok: false, error: "This column does not allow NULL." });
    expect(
      parseValueEditorDraft({
        state: "unloaded",
        draft: "",
        kind: "text",
        nullable: true,
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseValueEditorDraft({
        state: "empty",
        draft: "ignored",
        kind: "text",
        nullable: false,
      }),
    ).toEqual({ ok: true, value: "" });
  });

  it("preserves precise numeric input as database-cast text", () => {
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "9007199254740993.0000000001",
        kind: "number",
        nullable: false,
      }),
    ).toEqual({ ok: true, value: "9007199254740993.0000000001" });
  });

  it("validates integer shape and range before staging", () => {
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "1.5",
        kind: "number",
        columnType: "int4",
        nullable: false,
      }),
    ).toEqual({ ok: false, error: "Enter a whole integer value." });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "2147483648",
        kind: "number",
        columnType: "int4",
        nullable: false,
      }),
    ).toEqual({ ok: false, error: "Integer is outside the 32-bit range." });
  });

  it("validates canonical UUID values", () => {
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "not-a-uuid",
        kind: "text",
        columnType: "uuid",
        nullable: false,
      }),
    ).toEqual({ ok: false, error: "Enter a canonical UUID value." });
  });

  it("validates real calendar and timestamp values", () => {
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "2024-02-29",
        kind: "date",
        columnType: "date",
        nullable: false,
      }),
    ).toEqual({ ok: true, value: "2024-02-29" });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "2025-02-29",
        kind: "date",
        columnType: "date",
        nullable: false,
      }),
    ).toMatchObject({ ok: false });
    expect(
      parseValueEditorDraft({
        state: "value",
        draft: "2026-07-15 23:59:59.123456+08:00",
        kind: "date",
        columnType: "timestamp with time zone",
        nullable: false,
      }),
    ).toEqual({
      ok: true,
      value: "2026-07-15 23:59:59.123456+08:00",
    });
  });
});
