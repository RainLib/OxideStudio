export interface DataCompareSource {
  id: string;
  tabId: string;
  label: string;
  sourceKind: "table" | "query";
  resultIndex: number;
  page?: number;
  connectionId?: string;
  databaseName?: string;
  schemaName?: string;
  objectName?: string;
  columns: Array<{ name: string; dataType: string }>;
  rows: unknown[][];
  suggestedKeyColumns: string[];
  truncated: boolean;
  rowLimit?: number;
  capturedAt: number;
}

export type DataCompareRowStatus =
  | "equal"
  | "changed"
  | "leftOnly"
  | "rightOnly"
  | "duplicate";

export interface DataCompareFieldDifference {
  column: string;
  left: unknown;
  right: unknown;
  equal: boolean;
  toleranceMatched: boolean;
}

export interface DataCompareRow {
  id: string;
  status: DataCompareRowStatus;
  key: Array<{ column: string; value: unknown }>;
  leftRow?: unknown[];
  rightRow?: unknown[];
  fields: DataCompareFieldDifference[];
  leftMatchCount: number;
  rightMatchCount: number;
}

export interface DataCompareResult {
  rows: DataCompareRow[];
  keyColumns: string[];
  comparedColumns: string[];
  leftOnlyColumns: string[];
  rightOnlyColumns: string[];
  typeMismatchColumns: Array<{
    column: string;
    leftDataType: string;
    rightDataType: string;
  }>;
  counts: Record<DataCompareRowStatus, number>;
  comparedKeyCount: number;
  warnings: string[];
}

export interface DataCompareOptions {
  keyColumns: string[];
  /** Optional reviewed value-column subset. Key columns are always included separately. */
  comparedColumns?: string[];
  absoluteTolerance?: number;
  relativeTolerance?: number;
  maxRowsPerSide?: number;
}

export function sharedDataCompareColumns(
  left: DataCompareSource,
  right: DataCompareSource,
) {
  const rightColumns = new Set(right.columns.map((column) => column.name));
  return left.columns
    .map((column) => column.name)
    .filter((name) => rightColumns.has(name));
}

export function suggestedDataCompareKeys(
  left: DataCompareSource,
  right: DataCompareSource,
) {
  const shared = new Set(sharedDataCompareColumns(left, right));
  const rightSuggested = new Set(right.suggestedKeyColumns);
  const hasSameSuggestedKey =
    left.suggestedKeyColumns.length > 0 &&
    left.suggestedKeyColumns.length === rightSuggested.size &&
    left.suggestedKeyColumns.every((column) => rightSuggested.has(column));
  if (hasSameSuggestedKey) return [...left.suggestedKeyColumns];
  if (shared.has("id")) return ["id"];
  const first = [...shared][0];
  return first ? [first] : [];
}

export function compareDataSources(
  left: DataCompareSource,
  right: DataCompareSource,
  options: DataCompareOptions,
): DataCompareResult {
  const ambiguousColumns = unique([
    ...duplicateColumnNames(left),
    ...duplicateColumnNames(right),
  ]);
  if (ambiguousColumns.length > 0) {
    throw new Error(
      `Duplicate result column names cannot be mapped safely: ${ambiguousColumns.join(", ")}. Alias them uniquely and run the query again.`,
    );
  }
  const sharedColumns = sharedDataCompareColumns(left, right);
  const sharedSet = new Set(sharedColumns);
  const keyColumns = unique(options.keyColumns).filter((column) =>
    sharedSet.has(column),
  );
  if (keyColumns.length === 0) {
    throw new Error("Select at least one column that exists on both sides.");
  }
  const maxRowsPerSide = clampInteger(options.maxRowsPerSide ?? 5_000, 1, 25_000);
  if (left.rows.length > maxRowsPerSide || right.rows.length > maxRowsPerSide) {
    throw new Error(
      `Data Compare accepts at most ${maxRowsPerSide.toLocaleString()} loaded rows per side.`,
    );
  }

  const requestedComparedColumns = options.comparedColumns
    ? new Set(options.comparedColumns)
    : null;
  const comparedColumns = sharedColumns.filter(
    (column) =>
      !keyColumns.includes(column) &&
      (!requestedComparedColumns || requestedComparedColumns.has(column)),
  );
  const leftColumnNames = new Set(left.columns.map((column) => column.name));
  const rightColumnNames = new Set(right.columns.map((column) => column.name));
  const leftOnlyColumns = [...leftColumnNames].filter(
    (column) => !rightColumnNames.has(column),
  );
  const rightOnlyColumns = [...rightColumnNames].filter(
    (column) => !leftColumnNames.has(column),
  );
  const rightTypes = new Map(
    right.columns.map((column) => [column.name, column.dataType]),
  );
  const typeMismatchColumns = left.columns
    .filter(
      (column) =>
        rightTypes.has(column.name) &&
        rightTypes.get(column.name) !== column.dataType,
    )
    .map((column) => ({
      column: column.name,
      leftDataType: column.dataType,
      rightDataType: rightTypes.get(column.name) || "unknown",
    }));
  const leftIndexes = columnIndexes(left);
  const rightIndexes = columnIndexes(right);
  const leftGroups = groupRows(left.rows, keyColumns, leftIndexes);
  const rightGroups = groupRows(right.rows, keyColumns, rightIndexes);
  const keys = [...new Set([...leftGroups.keys(), ...rightGroups.keys()])].sort();
  const absoluteTolerance = finiteNonNegative(options.absoluteTolerance);
  const relativeTolerance = finiteNonNegative(options.relativeTolerance);
  const rows: DataCompareRow[] = keys.map((keyId) => {
    const leftMatches = leftGroups.get(keyId) || [];
    const rightMatches = rightGroups.get(keyId) || [];
    const key = keyColumns.map((column) => ({
      column,
      value: leftMatches.length > 0
        ? leftMatches[0]?.[leftIndexes.get(column)!]
        : rightMatches[0]?.[rightIndexes.get(column)!],
    }));
    if (leftMatches.length > 1 || rightMatches.length > 1) {
      return {
        id: keyId,
        status: "duplicate",
        key,
        fields: [],
        leftMatchCount: leftMatches.length,
        rightMatchCount: rightMatches.length,
      };
    }
    if (leftMatches.length === 0) {
      return {
        id: keyId,
        status: "rightOnly",
        key,
        rightRow: rightMatches[0],
        fields: [],
        leftMatchCount: 0,
        rightMatchCount: 1,
      };
    }
    if (rightMatches.length === 0) {
      return {
        id: keyId,
        status: "leftOnly",
        key,
        leftRow: leftMatches[0],
        fields: [],
        leftMatchCount: 1,
        rightMatchCount: 0,
      };
    }

    const fields = comparedColumns.map((column) => {
      const leftValue = leftMatches[0]?.[leftIndexes.get(column)!];
      const rightValue = rightMatches[0]?.[rightIndexes.get(column)!];
      const exact = valuesEqual(leftValue, rightValue);
      const toleranceMatched =
        !exact &&
        numericValuesWithinTolerance(
          leftValue,
          rightValue,
          absoluteTolerance,
          relativeTolerance,
        );
      return {
        column,
        left: leftValue,
        right: rightValue,
        equal: exact || toleranceMatched,
        toleranceMatched,
      };
    });
    return {
      id: keyId,
      status: fields.every((field) => field.equal) ? "equal" : "changed",
      key,
      leftRow: leftMatches[0],
      rightRow: rightMatches[0],
      fields,
      leftMatchCount: 1,
      rightMatchCount: 1,
    };
  });

  const counts: DataCompareResult["counts"] = {
    equal: 0,
    changed: 0,
    leftOnly: 0,
    rightOnly: 0,
    duplicate: 0,
  };
  rows.forEach((row) => {
    counts[row.status] += 1;
  });
  const warnings: string[] = [];
  if (left.truncated || right.truncated) {
    warnings.push(
      "At least one source is truncated; absence is only relative to the loaded rows.",
    );
  }
  if (leftOnlyColumns.length > 0 || rightOnlyColumns.length > 0) {
    warnings.push(
      "Columns present on only one side are reported but not compared as row values.",
    );
  }
  if (typeMismatchColumns.length > 0) {
    warnings.push(
      "Some same-named columns have different declared types; values are compared without coercion unless numeric tolerance applies.",
    );
  }
  if (counts.duplicate > 0) {
    warnings.push(
      "Duplicate keys are ambiguous and are not paired or silently overwritten.",
    );
  }

  return {
    rows,
    keyColumns,
    comparedColumns,
    leftOnlyColumns,
    rightOnlyColumns,
    typeMismatchColumns,
    counts,
    comparedKeyCount: rows.length,
    warnings,
  };
}

function columnIndexes(source: DataCompareSource) {
  return new Map(source.columns.map((column, index) => [column.name, index]));
}

function groupRows(
  rows: unknown[][],
  keyColumns: string[],
  indexes: Map<string, number>,
) {
  const groups = new Map<string, unknown[][]>();
  for (const row of rows) {
    const key = stableValue(keyColumns.map((column) => row[indexes.get(column)!]));
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function stableValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (Object.is(value, -0)) return "number:-0";
    return `number:${value}`;
  }
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return `boolean:${value}`;
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) {
    return `array:[${value.map(stableValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `object:{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`)
      .join(",")}}`;
  }
  return `${typeof value}:${String(value)}`;
}

function valuesEqual(left: unknown, right: unknown) {
  return stableValue(left) === stableValue(right);
}

function numericValuesWithinTolerance(
  left: unknown,
  right: unknown,
  absoluteTolerance: number,
  relativeTolerance: number,
) {
  if (absoluteTolerance === 0 && relativeTolerance === 0) return false;
  const leftNumber = strictNumber(left);
  const rightNumber = strictNumber(right);
  if (leftNumber === null || rightNumber === null) return false;
  const difference = Math.abs(leftNumber - rightNumber);
  const allowed =
    absoluteTolerance +
    relativeTolerance * Math.max(Math.abs(leftNumber), Math.abs(rightNumber));
  return difference <= allowed;
}

function strictNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function finiteNonNegative(value?: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function duplicateColumnNames(source: DataCompareSource) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  source.columns.forEach((column) => {
    if (seen.has(column.name)) duplicates.add(column.name);
    seen.add(column.name);
  });
  return [...duplicates];
}
