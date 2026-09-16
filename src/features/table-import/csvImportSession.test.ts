import { describe, expect, it } from "vitest";
import { CsvImportSession, type CsvAnalysisOptions } from "./csvImportSession";

const options: CsvAnalysisOptions = {
  encoding: "auto", delimiter: "auto", titleRow: 1, dataStartRow: 2, lastDataRow: 0,
  emptyAsNull: true, trimValues: false,
  mapping: [{ sourceIndex: 0, sourceName: "name", targetColumn: "name" }],
  columns: [{ name: "name", data_type: "text", is_nullable: false, is_primary_key: false }],
};
describe("worker-owned CSV review", () => {
  it("returns a bounded preview while validating rows after the preview", () => {
    const session = new CsvImportSession(new TextEncoder().encode(
      "name,extra\n" + Array.from({ length: 80 }, (_, i) => i === 70 ? ",x" : `name${i},x`).join("\n"),
    ));
    const preview = session.analyze(1, options);
    expect(preview.previewRecords).toHaveLength(50);
    expect(preview.dataRowCount).toBe(80);
    expect(preview.errorCount).toBe(1);
    expect(preview.issues[0]?.line).toBe(72);
    expect(preview).not.toHaveProperty("rows");
    expect(() => session.rows(1)).toThrow("review changed");
  });

  it("only returns the exact latest validated mapping on submission", () => {
    const session = new CsvImportSession(new TextEncoder().encode('name\n"a,b"\n"multi\nline"\n'));
    expect(session.analyze(1, options).rowCount).toBe(2);
    expect(session.rows(1)).toEqual([{ name: "a,b" }, { name: "multi\nline" }]);
    session.analyze(2, { ...options, mapping: [] });
    expect(() => session.rows(1)).toThrow();
    expect(() => session.rows(2)).toThrow();
    const oddBytes = new CsvImportSession(new TextEncoder().encode("name\nx\n"));
    oddBytes.analyze(3, options);
    expect(() => oddBytes.analyze(4, { ...options, encoding: "utf-16le" })).toThrow();
    expect(() => oddBytes.rows(3)).toThrow();
  });

  it("blocks excessive selected rows and supports explicit ranges", () => {
    const session = new CsvImportSession(new TextEncoder().encode("name\n" + "a\n".repeat(100_001)));
    expect(session.analyze(1, options).error).toContain("100,000");
    expect(() => session.rows(1)).toThrow();
    const ranged = session.analyze(2, { ...options, dataStartRow: 100_000, lastDataRow: 100_002 });
    expect(ranged.rowCount).toBe(3);
  });
});
