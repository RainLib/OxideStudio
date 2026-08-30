import { describe, expect, it } from "vitest";
import { decodeCsvBytes } from "./csvImport";

describe("decodeCsvBytes", () => {
  it("auto-detects UTF-16 BOM and strips it before preview", () => {
    const bytes = new Uint8Array([
      0xff, 0xfe,
      0x69, 0x00, 0x64, 0x00, 0x0a, 0x00,
      0x31, 0x00, 0x0a, 0x00,
    ]);

    expect(decodeCsvBytes(bytes, "auto")).toEqual({
      text: "id\n1\n",
      encoding: "utf-16le",
    });
  });

  it("falls back from strict UTF-8 to GB18030 during automatic detection", () => {
    const bytes = new Uint8Array([
      0x6e, 0x61, 0x6d, 0x65, 0x0a,
      0xd6, 0xd0, 0xce, 0xc4, 0x0a,
    ]);

    expect(decodeCsvBytes(bytes, "auto")).toEqual({
      text: "name\n中文\n",
      encoding: "gb18030",
    });
  });

  it("rejects malformed bytes instead of inserting replacement characters", () => {
    expect(() => decodeCsvBytes(new Uint8Array([0x61, 0xff]), "utf-8"))
      .toThrow("invalid bytes for UTF-8");
  });
});
