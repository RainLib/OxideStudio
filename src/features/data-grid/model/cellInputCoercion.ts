import { resultColumnTypeFamily } from "./resultColumnType";

export interface NumericInputNumberFormat {
  groupSeparator?: string;
  decimalSeparator?: string;
}
let cachedRuntimeNumberFormat: NumericInputNumberFormat | undefined;

export function runtimeNumericInputNumberFormat(): NumericInputNumberFormat {
  if (cachedRuntimeNumberFormat) return cachedRuntimeNumberFormat;
  const parts = new Intl.NumberFormat().formatToParts(12_345.6);
  cachedRuntimeNumberFormat = {
    groupSeparator: parts.find((part) => part.type === "group")?.value,
    decimalSeparator: parts.find((part) => part.type === "decimal")?.value,
  };
  return cachedRuntimeNumberFormat;
}

/**
 * Normalizes spreadsheet-style comma separators only for numeric columns.
 * Exact decimal text stays text so 64-bit values are never rounded through
 * JavaScript Number.
 */
export function normalizeDataGridNumericInput(
  value: unknown,
  dataType: string | null | undefined,
  numberFormat = runtimeNumericInputNumberFormat(),
): unknown {
  if (typeof value !== "string" || resultColumnTypeFamily(dataType) !== "number") {
    return value;
  }

  const trimmed = value.trim();
  const match = trimmed.match(
    /^([+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?)([eE][+-]?\d+)?$/u,
  );
  if (!match) return value;

  const mantissa = match[1]!;
  const exponent = match[2] ?? "";
  if (/^[+-]?\d{1,3},\d{3}$/u.test(mantissa)) {
    if (
      numberFormat.groupSeparator === "," &&
      numberFormat.decimalSeparator !== ","
    ) {
      return `${mantissa.replace(",", "")}${exponent}`;
    }
    if (numberFormat.decimalSeparator === ",") {
      return `${mantissa.replace(",", ".")}${exponent}`;
    }
    return value;
  }

  return `${mantissa.replace(/,/gu, "")}${exponent}`;
}
