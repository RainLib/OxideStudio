import { resultColumnTypeFamily } from "./resultColumnType";

export type DataGridSortDirection = "asc" | "desc";

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function sortDataGridRowIndexes(options: {
  rows: readonly (readonly unknown[])[];
  rowIndexes: readonly number[];
  columnIndex: number;
  direction: DataGridSortDirection;
  columnType?: string;
}) {
  return [...options.rowIndexes].sort((leftIndex, rightIndex) => {
    const compared = compareDataGridValues(
      options.rows[leftIndex]?.[options.columnIndex],
      options.rows[rightIndex]?.[options.columnIndex],
      options.direction,
      options.columnType,
    );
    return compared || leftIndex - rightIndex;
  });
}

export function compareDataGridValues(
  left: unknown,
  right: unknown,
  direction: DataGridSortDirection,
  columnType?: string,
) {
  const emptyCompared = compareEmptyValues(left, right);
  if (emptyCompared !== null) return emptyCompared;

  const directionMultiplier = direction === "asc" ? 1 : -1;
  if (resultColumnTypeFamily(columnType) === "number") {
    const numericCompared = compareNumericCellValues(left, right);
    if (numericCompared !== null) return numericCompared * directionMultiplier;
  }

  let compared: number;
  if (typeof left === "number" && typeof right === "number") {
    compared = compareNumbers(left, right);
  } else if (typeof left === "boolean" && typeof right === "boolean") {
    compared = Number(left) - Number(right);
  } else if (typeof left === "string" && typeof right === "string") {
    const leftDate = dateSortValue(left);
    const rightDate = dateSortValue(right);
    compared =
      leftDate !== null && rightDate !== null
        ? compareNumbers(leftDate, rightDate)
        : collator.compare(left, right);
  } else {
    compared = collator.compare(String(left), String(right));
  }
  return compared * directionMultiplier;
}

type NumericSortValue = {
  sign: -1 | 0 | 1;
  magnitude: bigint;
  digits: string;
};

function compareNumericCellValues(left: unknown, right: unknown) {
  const leftNumber = parseNumericSortValue(left);
  const rightNumber = parseNumericSortValue(right);
  if (!leftNumber || !rightNumber) return null;
  if (leftNumber.sign !== rightNumber.sign) {
    return leftNumber.sign - rightNumber.sign;
  }
  if (leftNumber.sign === 0) return 0;

  let compared = compareBigInts(leftNumber.magnitude, rightNumber.magnitude);
  if (compared === 0) {
    const width = Math.max(leftNumber.digits.length, rightNumber.digits.length);
    compared = leftNumber.digits
      .padEnd(width, "0")
      .localeCompare(rightNumber.digits.padEnd(width, "0"));
  }
  return leftNumber.sign === 1 ? compared : -compared;
}

function parseNumericSortValue(value: unknown): NumericSortValue | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const unsigned = /^[+-]/u.test(text) ? text.slice(1) : text;
  const match = unsigned.match(/^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u);
  if (!match) return null;

  const integerDigits = match[1] ?? "";
  const fractionDigits = match[2] ?? "";
  const allDigits = `${integerDigits}${fractionDigits}`;
  if (!allDigits) return null;
  const leadingZeroCount = allDigits.match(/^0*/u)?.[0].length ?? 0;
  const digits = allDigits.slice(leadingZeroCount);
  if (!digits) return { sign: 0, magnitude: 0n, digits: "0" };

  const exponent = BigInt(match[3] ?? "0");
  const magnitude = BigInt(integerDigits.length - leadingZeroCount) + exponent;
  return { sign: negative ? -1 : 1, magnitude, digits };
}

function compareBigInts(left: bigint, right: bigint) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareEmptyValues(left: unknown, right: unknown) {
  const leftEmpty = left === null || left === undefined;
  const rightEmpty = right === null || right === undefined;
  if (!leftEmpty && !rightEmpty) return null;
  if (leftEmpty && rightEmpty) return 0;
  return leftEmpty ? 1 : -1;
}

function compareNumbers(left: number, right: number) {
  if (Number.isNaN(left) || Number.isNaN(right)) {
    if (Number.isNaN(left) && Number.isNaN(right)) return 0;
    return Number.isNaN(left) ? 1 : -1;
  }
  return left - right;
}

function dateSortValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}/u.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
