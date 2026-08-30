import type { ColumnInfo } from "@/services/tauri/types";
import {
  inferValueEditorKind,
  parseValueEditorDraft,
  valueEditorSupportsEmpty,
} from "@/lib/valueEditor";

export type CsvEncoding =
  | "auto"
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "gb18030";

export interface CsvRecord {
  values: string[];
  line: number;
}

export interface CsvImportIssue {
  line?: number;
  sourceColumn?: string;
  targetColumn?: string;
  message: string;
}

export interface CsvParseResult {
  records: CsvRecord[];
  issues: CsvImportIssue[];
}

export interface CsvColumnMapping {
  sourceIndex: number;
  sourceName: string;
  targetColumn: string | null;
}

export interface CsvImportPlan {
  rows: Array<Record<string, unknown>>;
  issues: CsvImportIssue[];
  errorCount: number;
}

export interface CsvRowSelection {
  hasHeader: boolean;
  titleRow?: number;
  dataStartRow?: number;
  lastDataRow?: number;
}

const DELIMITER_CANDIDATES = [",", ";", "\t", "|"] as const;
const MAX_REPORTED_ISSUES = 200;

export function decodeCsvBytes(
  bytes: ArrayBuffer | Uint8Array,
  requestedEncoding: CsvEncoding,
) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bomEncoding = detectBomEncoding(view);
  const candidates: Array<Exclude<CsvEncoding, "auto">> =
    requestedEncoding === "auto"
      ? [bomEncoding || "utf-8", ...(bomEncoding ? [] : ["gb18030" as const])]
      : [requestedEncoding];
  for (const encoding of candidates) {
    try {
      const offset = bomLength(view, encoding);
      const text = new TextDecoder(encoding, { fatal: true })
        .decode(view.subarray(offset))
        .replace(/^\uFEFF/, "");
      return { text, encoding };
    } catch {
      // Try the next reviewed automatic-detection candidate.
    }
  }
  throw new Error(
    `The CSV contains invalid bytes for ${requestedEncoding === "auto" ? "UTF-8 and GB18030" : requestedEncoding.toUpperCase()}. Select the correct encoding before importing.`,
  );
}

export function inferCsvDelimiter(text: string) {
  let bestDelimiter: string = ",";
  let bestScore = -1;

  for (const delimiter of DELIMITER_CANDIDATES) {
    const parsed = parseCsv(text, delimiter, 20);
    const widths = parsed.records.map((record) => record.values.length);
    if (widths.length === 0) continue;

    const counts = new Map<number, number>();
    for (const width of widths) {
      counts.set(width, (counts.get(width) || 0) + 1);
    }
    const [modeWidth, modeCount] = [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || right[0] - left[0],
    )[0]!;
    const score = modeWidth > 1 ? modeCount * 100 + modeWidth : modeCount;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  }

  return bestDelimiter;
}

export function parseCsv(
  text: string,
  delimiter: string,
  recordLimit = Number.POSITIVE_INFINITY,
): CsvParseResult {
  if (delimiter.length !== 1 || delimiter === '"' || /[\r\n]/.test(delimiter)) {
    return {
      records: [],
      issues: [{ message: "Delimiter must be one non-line-break character." }],
    };
  }

  const records: CsvRecord[] = [];
  const issues: CsvImportIssue[] = [];
  let values: string[] = [];
  let value = "";
  let line = 1;
  let recordLine = 1;
  let inQuotes = false;
  let afterClosingQuote = false;

  const finishRecord = () => {
    values.push(value);
    if (values.some((item) => item.length > 0)) {
      records.push({ values, line: recordLine });
    }
    values = [];
    value = "";
    afterClosingQuote = false;
    recordLine = line;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (records.length >= recordLimit) break;
    const character = text[index]!;
    const nextCharacter = text[index + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        afterClosingQuote = true;
      } else {
        value += character;
        if (character === "\n") line += 1;
        else if (character === "\r" && nextCharacter !== "\n") line += 1;
      }
      continue;
    }

    if (character === '"' && value.length === 0 && !afterClosingQuote) {
      inQuotes = true;
      continue;
    }

    if (character === delimiter) {
      values.push(value);
      value = "";
      afterClosingQuote = false;
      continue;
    }

    if (character === "\n" || character === "\r") {
      if (character === "\r" && nextCharacter === "\n") index += 1;
      line += 1;
      finishRecord();
      recordLine = line;
      continue;
    }

    if (afterClosingQuote && !/\s/.test(character)) {
      issues.push({
        line,
        message: `Unexpected character "${character}" after a closing quote.`,
      });
    }
    value += character;
  }

  if (inQuotes) {
    issues.push({ line: recordLine, message: "Quoted field is not closed." });
  }
  if (
    records.length < recordLimit &&
    (value.length > 0 || values.length > 0)
  ) {
    finishRecord();
  }

  return { records, issues };
}

function resolvedCsvRowSelection(options: CsvRowSelection) {
  const titleRow = options.hasHeader ? options.titleRow ?? 1 : 0;
  const dataStartRow = options.dataStartRow ?? (titleRow > 0 ? titleRow + 1 : 1);
  const lastDataRow = options.lastDataRow ?? 0;
  return { titleRow, dataStartRow, lastDataRow };
}

export function validateCsvRowSelection(options: CsvRowSelection) {
  const { titleRow, dataStartRow, lastDataRow } = resolvedCsvRowSelection(options);
  if (!Number.isInteger(titleRow) || titleRow < 0) {
    return "Title row must be zero or a positive whole number.";
  }
  if (!Number.isInteger(dataStartRow) || dataStartRow < 1) {
    return "Data start row must be a positive whole number.";
  }
  if (titleRow > 0 && titleRow >= dataStartRow) {
    return "Title row must be before the data start row.";
  }
  if (!Number.isInteger(lastDataRow) || lastDataRow < 0) {
    return "Last data row must be zero or a positive whole number.";
  }
  if (lastDataRow > 0 && lastDataRow < dataStartRow) {
    return "Last data row must not be before the data start row.";
  }
  return null;
}

export function selectCsvDataRecords(
  records: CsvRecord[],
  options: CsvRowSelection,
) {
  if (validateCsvRowSelection(options)) return [];
  const { dataStartRow, lastDataRow } = resolvedCsvRowSelection(options);
  return records.filter((_, index) => {
    const rowNumber = index + 1;
    return rowNumber >= dataStartRow && (lastDataRow === 0 || rowNumber <= lastDataRow);
  });
}

export function csvSourceColumns(
  records: CsvRecord[],
  hasHeader: boolean,
  titleRow = hasHeader ? 1 : 0,
  dataStartRow = titleRow > 0 ? titleRow + 1 : 1,
  lastDataRow = 0,
) {
  const selectedRecords = selectCsvDataRecords(records, {
    hasHeader,
    titleRow,
    dataStartRow,
    lastDataRow,
  });
  const header = hasHeader ? records[titleRow - 1]?.values || [] : [];
  const maximumWidth = [...selectedRecords, ...(hasHeader ? [{ values: header, line: titleRow }] : [])].reduce(
    (width, record) => Math.max(width, record.values.length),
    0,
  );

  return Array.from({ length: maximumWidth }, (_, index) => {
    const name = header[index]?.trim();
    return name || `Column ${index + 1}`;
  });
}

export function createCsvColumnMapping(
  sourceColumns: string[],
  targetColumns: ColumnInfo[],
  hasHeader: boolean,
): CsvColumnMapping[] {
  const targetByLower = new Map<string, string | null>();
  for (const column of targetColumns) {
    const key = column.name.toLowerCase();
    const previous = targetByLower.get(key);
    targetByLower.set(
      key,
      previous === undefined || previous === column.name ? column.name : null,
    );
  }

  const usedTargets = new Set<string>();
  return sourceColumns.map((sourceName, sourceIndex) => {
    const candidate = hasHeader
      ? targetByLower.get(sourceName.toLowerCase())
      : targetColumns[sourceIndex]?.name;
    const targetColumn = candidate && !usedTargets.has(candidate)
      ? candidate
      : null;
    if (targetColumn) usedTargets.add(targetColumn);
    return { sourceIndex, sourceName, targetColumn };
  });
}

export function buildCsvImportPlan(options: {
  records: CsvRecord[];
  parseIssues?: CsvImportIssue[];
  hasHeader: boolean;
  titleRow?: number;
  dataStartRow?: number;
  lastDataRow?: number;
  mapping: CsvColumnMapping[];
  columns: ColumnInfo[];
  emptyAsNull: boolean;
  trimValues?: boolean;
}): CsvImportPlan {
  const {
    records,
    parseIssues = [],
    hasHeader,
    titleRow,
    dataStartRow,
    lastDataRow,
    mapping,
    columns,
    emptyAsNull,
    trimValues = false,
  } = options;
  const issues: CsvImportIssue[] = [];
  let errorCount = 0;
  const addIssue = (issue: CsvImportIssue) => {
    errorCount += 1;
    if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue);
  };
  parseIssues.forEach(addIssue);
  const rowSelection = { hasHeader, titleRow, dataStartRow, lastDataRow };
  const rowSelectionError = validateCsvRowSelection(rowSelection);
  if (rowSelectionError) addIssue({ message: rowSelectionError });

  const columnsByName = new Map(columns.map((column) => [column.name, column]));
  const mappedTargets = new Set<string>();
  for (const item of mapping) {
    if (!item.targetColumn) continue;
    if (!columnsByName.has(item.targetColumn)) {
      addIssue({
        sourceColumn: item.sourceName,
        targetColumn: item.targetColumn,
        message: "Mapped target column does not exist.",
      });
    } else if (mappedTargets.has(item.targetColumn)) {
      addIssue({
        sourceColumn: item.sourceName,
        targetColumn: item.targetColumn,
        message: "A target column can only be mapped once.",
      });
    }
    mappedTargets.add(item.targetColumn);
  }

  if (mappedTargets.size === 0) {
    addIssue({ message: "Map at least one CSV column to a table column." });
  }

  for (const column of columns) {
    const hasDefault = column.default_value !== undefined && column.default_value !== null;
    if (
      !mappedTargets.has(column.name) &&
      !column.is_nullable &&
      !column.is_auto_increment &&
      !hasDefault
    ) {
      addIssue({
        targetColumn: column.name,
        message: "Required column is not mapped and has no default value.",
      });
    }
  }

  const dataRecords = selectCsvDataRecords(records, rowSelection);
  const rows: Array<Record<string, unknown>> = [];
  for (const record of dataRecords) {
    const row: Record<string, unknown> = {};
    let rowHasError = false;

    for (const item of mapping) {
      if (!item.targetColumn) continue;
      const column = columnsByName.get(item.targetColumn);
      if (!column) continue;
      const sourceValue = record.values[item.sourceIndex] ?? "";
      const rawValue = trimValues ? sourceValue.trim() : sourceValue;
      const kind = inferValueEditorKind(column.data_type, rawValue);
      const state = rawValue.length === 0
        ? emptyAsNull
          ? "null"
          : valueEditorSupportsEmpty(kind)
            ? "empty"
            : "value"
        : "value";
      const parsed = parseValueEditorDraft({
        state,
        draft: rawValue,
        kind,
        columnType: column.data_type,
        nullable: column.is_nullable,
      });
      if (!parsed.ok) {
        rowHasError = true;
        addIssue({
          line: record.line,
          sourceColumn: item.sourceName,
          targetColumn: column.name,
          message: parsed.error,
        });
      } else {
        row[column.name] = parsed.value;
      }
    }

    if (!rowHasError && Object.keys(row).length > 0) rows.push(row);
  }

  if (dataRecords.length === 0) {
    addIssue({ message: "CSV file has no data rows." });
  }

  return { rows, issues, errorCount };
}

function detectBomEncoding(bytes: Uint8Array): Exclude<CsvEncoding, "auto" | "gb18030"> | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

function bomLength(bytes: Uint8Array, encoding: Exclude<CsvEncoding, "auto">) {
  if (
    encoding === "utf-8" &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return 3;
  }
  if (
    (encoding === "utf-16le" && bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (encoding === "utf-16be" && bytes[0] === 0xfe && bytes[1] === 0xff)
  ) {
    return 2;
  }
  return 0;
}
