export const MAX_SELECTION_AGGREGATE_CELLS = 50_000;

export interface SelectionAggregateCell {
  value: unknown;
  dataType?: string;
}

export interface SelectionRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionCoordinateInput {
  ranges?: readonly SelectionRectangle[];
  rows?: readonly number[];
  columns?: readonly number[];
  rowCount: number;
  columnCount: number;
  limit?: number;
}

export interface SelectionCoordinates {
  coordinates: Array<readonly [row: number, column: number]>;
  truncated: boolean;
}

export interface SelectionAggregate {
  selectedCellCount: number;
  nonNullCount: number;
  nullCount: number;
  unavailableCount: number;
  distinctCount: number;
  numericCount: number;
  sum?: string;
  average?: string;
  minimum?: string;
  maximum?: string;
  truncated: boolean;
}

interface DecimalValue {
  coefficient: bigint;
  scale: number;
}

const NUMERIC_DATA_TYPE =
  /(?:^|\b)(?:tinyint|smallint|mediumint|int|integer|bigint|serial|smallserial|bigserial|decimal|numeric|number|real|float|double)(?:\b|$)/i;
const MAX_DECIMAL_INPUT_LENGTH = 256;
const MAX_DECIMAL_SCALE = 1_000;
const AVERAGE_PRECISION = 12;

/** Deduplicate mixed range/row/column selections and stop at a hard UI budget. */
export function collectSelectionCoordinates({
  ranges = [],
  rows = [],
  columns = [],
  rowCount,
  columnCount,
  limit = MAX_SELECTION_AGGREGATE_CELLS,
}: SelectionCoordinateInput): SelectionCoordinates {
  const coordinates: Array<readonly [number, number]> = [];
  const seen = new Set<string>();
  const boundedLimit = Math.max(1, limit);

  const add = (row: number, column: number) => {
    if (
      row < 0 ||
      row >= rowCount ||
      column < 0 ||
      column >= columnCount
    ) {
      return false;
    }
    const key = `${row}:${column}`;
    if (seen.has(key)) return false;
    if (coordinates.length >= boundedLimit) return true;
    seen.add(key);
    coordinates.push([row, column]);
    return false;
  };

  for (const range of ranges) {
    for (let row = range.y; row < range.y + range.height; row += 1) {
      for (let column = range.x; column < range.x + range.width; column += 1) {
        if (add(row, column)) return { coordinates, truncated: true };
      }
    }
  }
  for (const row of rows) {
    for (let column = 0; column < columnCount; column += 1) {
      if (add(row, column)) return { coordinates, truncated: true };
    }
  }
  for (const column of columns) {
    for (let row = 0; row < rowCount; row += 1) {
      if (add(row, column)) return { coordinates, truncated: true };
    }
  }

  return { coordinates, truncated: false };
}

function powerOfTen(exponent: number) {
  return 10n ** BigInt(exponent);
}

function normalizeDecimal(value: DecimalValue): DecimalValue {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function decimalFromValue(value: unknown, dataType?: string) {
  if (!dataType || !NUMERIC_DATA_TYPE.test(dataType)) return null;
  if (
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    typeof value !== "string"
  ) {
    return null;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;

  const source = String(value).trim();
  if (source.length === 0 || source.length > MAX_DECIMAL_INPUT_LENGTH) {
    return null;
  }
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(source);
  if (!match) return null;

  const fraction = match[3] || "";
  const exponent = Number.parseInt(match[4] || "0", 10);
  if (!Number.isSafeInteger(exponent)) return null;
  let scale = fraction.length - exponent;
  if (Math.abs(scale) > MAX_DECIMAL_SCALE) return null;

  let coefficient = BigInt(`${match[2]}${fraction}`);
  if (match[1] === "-") coefficient = -coefficient;
  if (scale < 0) {
    coefficient *= powerOfTen(-scale);
    scale = 0;
  }
  return normalizeDecimal({ coefficient, scale });
}

function alignDecimals(left: DecimalValue, right: DecimalValue) {
  const scale = Math.max(left.scale, right.scale);
  return {
    left: left.coefficient * powerOfTen(scale - left.scale),
    right: right.coefficient * powerOfTen(scale - right.scale),
    scale,
  };
}

function addDecimals(left: DecimalValue, right: DecimalValue) {
  const aligned = alignDecimals(left, right);
  return normalizeDecimal({
    coefficient: aligned.left + aligned.right,
    scale: aligned.scale,
  });
}

function compareDecimals(left: DecimalValue, right: DecimalValue) {
  const aligned = alignDecimals(left, right);
  return aligned.left < aligned.right
    ? -1
    : aligned.left > aligned.right
      ? 1
      : 0;
}

function formatDecimal(value: DecimalValue) {
  const normalized = normalizeDecimal(value);
  const negative = normalized.coefficient < 0n;
  const digits = (negative
    ? -normalized.coefficient
    : normalized.coefficient
  ).toString();
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;

  const padded = digits.padStart(normalized.scale + 1, "0");
  const integer = padded.slice(0, -normalized.scale);
  const fraction = padded.slice(-normalized.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

function averageDecimal(sum: DecimalValue, count: number) {
  let numerator = sum.coefficient;
  let divisor = BigInt(count);
  if (AVERAGE_PRECISION >= sum.scale) {
    numerator *= powerOfTen(AVERAGE_PRECISION - sum.scale);
  } else {
    divisor *= powerOfTen(sum.scale - AVERAGE_PRECISION);
  }
  let quotient = numerator / divisor;
  const remainder = numerator % divisor;
  if (
    remainder !== 0n &&
    (remainder < 0n ? -remainder : remainder) * 2n >= divisor
  ) {
    quotient += numerator < 0n ? -1n : 1n;
  }
  return normalizeDecimal({
    coefficient: quotient,
    scale: AVERAGE_PRECISION,
  });
}

function stableValueKey(value: unknown): string {
  if (typeof value === "bigint") return `bigint:${value}`;
  if (typeof value !== "object" || value === null) {
    return `${typeof value}:${String(value)}`;
  }
  if (Array.isArray(value)) {
    return `array:[${value.map(stableValueKey).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `object:{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValueKey(record[key])}`)
    .join(",")}}`;
}

export function summarizeSelection(
  cells: readonly SelectionAggregateCell[],
  truncated = false,
): SelectionAggregate {
  let nullCount = 0;
  let unavailableCount = 0;
  let nonNullCount = 0;
  const distinctValues = new Set<string>();
  let numericCount = 0;
  let sum: DecimalValue = { coefficient: 0n, scale: 0 };
  let minimum: DecimalValue | null = null;
  let maximum: DecimalValue | null = null;

  for (const cell of cells) {
    if (cell.value === undefined) {
      unavailableCount += 1;
      continue;
    }
    if (cell.value === null) {
      nullCount += 1;
      continue;
    }

    nonNullCount += 1;
    distinctValues.add(stableValueKey(cell.value));
    const decimal = decimalFromValue(cell.value, cell.dataType);
    if (!decimal) continue;
    numericCount += 1;
    sum = addDecimals(sum, decimal);
    if (!minimum || compareDecimals(decimal, minimum) < 0) minimum = decimal;
    if (!maximum || compareDecimals(decimal, maximum) > 0) maximum = decimal;
  }

  return {
    selectedCellCount: cells.length,
    nonNullCount,
    nullCount,
    unavailableCount,
    distinctCount: distinctValues.size,
    numericCount,
    ...(numericCount > 0 && minimum && maximum
      ? {
          sum: formatDecimal(sum),
          average: formatDecimal(averageDecimal(sum, numericCount)),
          minimum: formatDecimal(minimum),
          maximum: formatDecimal(maximum),
        }
      : {}),
    truncated,
  };
}
