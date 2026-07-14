import { describe, expect, it } from "vitest";
import {
  collectSelectionCoordinates,
  summarizeSelection,
} from "@/lib/selectionAggregate";

describe("selection aggregates", () => {
  it("deduplicates mixed selections and enforces the computation budget", () => {
    expect(
      collectSelectionCoordinates({
        ranges: [{ x: 0, y: 0, width: 2, height: 2 }],
        rows: [0],
        columns: [1],
        rowCount: 3,
        columnCount: 3,
      }),
    ).toEqual({
      coordinates: [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
        [0, 2],
        [2, 1],
      ],
      truncated: false,
    });

    expect(
      collectSelectionCoordinates({
        rows: [0, 1],
        rowCount: 2,
        columnCount: 3,
        limit: 4,
      }),
    ).toEqual({
      coordinates: [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
      ],
      truncated: true,
    });
  });

  it("computes exact decimal aggregates without coercing text columns", () => {
    expect(
      summarizeSelection([
        { value: "9007199254740993", dataType: "bigint" },
        { value: "0.07", dataType: "numeric(20, 2)" },
        { value: "0.03", dataType: "decimal" },
        { value: "12", dataType: "varchar" },
      ]),
    ).toMatchObject({
      selectedCellCount: 4,
      nonNullCount: 4,
      distinctCount: 4,
      numericCount: 3,
      sum: "9007199254740993.1",
      average: "3002399751580331.033333333333",
      minimum: "0.03",
      maximum: "9007199254740993",
    });
  });

  it("separates NULL, unavailable, and non-NULL values", () => {
    expect(
      summarizeSelection([
        { value: null, dataType: "integer" },
        { value: undefined, dataType: "integer" },
        { value: 2, dataType: "integer" },
        { value: 2, dataType: "integer" },
      ]),
    ).toEqual({
      selectedCellCount: 4,
      nonNullCount: 2,
      nullCount: 1,
      unavailableCount: 1,
      distinctCount: 1,
      numericCount: 2,
      sum: "4",
      average: "2",
      minimum: "2",
      maximum: "2",
      truncated: false,
    });
  });

  it("normalizes exponent values and rounds repeating averages", () => {
    expect(
      summarizeSelection([
        { value: "1e-3", dataType: "double precision" },
        { value: "2e-3", dataType: "real" },
        { value: "1", dataType: "integer" },
      ]),
    ).toMatchObject({
      sum: "1.003",
      average: "0.334333333333",
      minimum: "0.001",
      maximum: "1",
    });
  });

  it("uses structural distinctness for JSON and reports bounded samples", () => {
    expect(
      summarizeSelection(
        [
          { value: { b: 2, a: 1 }, dataType: "jsonb" },
          { value: { a: 1, b: 2 }, dataType: "jsonb" },
          { value: [1, 2], dataType: "jsonb" },
        ],
        true,
      ),
    ).toMatchObject({
      distinctCount: 2,
      numericCount: 0,
      truncated: true,
    });
  });

  it("excludes non-finite and pathologically large numeric text", () => {
    expect(
      summarizeSelection([
        { value: Number.POSITIVE_INFINITY, dataType: "double" },
        { value: "9".repeat(300), dataType: "numeric" },
      ]),
    ).toMatchObject({
      nonNullCount: 2,
      numericCount: 0,
      distinctCount: 2,
    });
  });
});
