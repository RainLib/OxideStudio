export type ValueEditorKind =
  "text" | "json" | "array" | "date" | "binary" | "number" | "boolean";

export type ValueEditorState = "unloaded" | "value" | "empty" | "null";

export interface ParsedValueEditorDraft {
  ok: true;
  value: unknown;
}

export interface InvalidValueEditorDraft {
  ok: false;
  error: string;
}

export type ValueEditorDraftResult =
  ParsedValueEditorDraft | InvalidValueEditorDraft;

export type JsonPreviewResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Keep inspection parsing bounded so a cell preview cannot stall the editor. */
export const JSON_TREE_PREVIEW_MAX_CHARACTERS = 1_000_000;

const JSON_TYPE = /\b(jsonb?|object|map|document)\b/i;
const ARRAY_TYPE = /(?:\[\]\s*$|\barray\b)/i;
const BINARY_TYPE =
  /\b(bytea|binary|varbinary|tinyblob|blob|mediumblob|longblob|raw)\b/i;
const DATE_TYPE = /\b(date|time|timestamp|datetime|timestamptz|timetz)\b/i;
const NUMBER_TYPE =
  /\b(tinyint|smallint|mediumint|bigint|integer|int[248]?|smallserial|bigserial|serial|decimal|numeric|real|double(?:\s+precision)?|float|money|number)\b/i;
const BOOLEAN_TYPE = /\b(bool|boolean)\b/i;
const INTEGER_TYPE =
  /\b(tinyint|smallint|mediumint|bigint|integer|int[248]?|smallserial|bigserial|serial)\b/i;
const UUID_TYPE = /\buuid\b/i;

export function inferValueEditorKind(
  columnType: string | null | undefined,
  value: unknown,
): ValueEditorKind {
  const normalizedType = columnType?.trim() || "";
  if (ARRAY_TYPE.test(normalizedType)) return "array";
  if (JSON_TYPE.test(normalizedType)) return "json";
  if (BINARY_TYPE.test(normalizedType)) return "binary";
  if (DATE_TYPE.test(normalizedType)) return "date";
  if (BOOLEAN_TYPE.test(normalizedType)) return "boolean";
  if (NUMBER_TYPE.test(normalizedType)) return "number";

  if (typeof value === "object" && value !== null) return "json";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?/.test(value)
  ) {
    return "date";
  }
  return "text";
}

export function valueEditorState(value: unknown): ValueEditorState {
  if (value === undefined) return "unloaded";
  if (value === null) return "null";
  if (value === "") return "empty";
  return "value";
}

export function valueEditorDraft(
  value: unknown,
  kind: ValueEditorKind,
): string {
  if (value === undefined || value === null) return "";
  if (kind === "json" || typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function valueEditorSupportsEmpty(kind: ValueEditorKind) {
  return kind === "text" || kind === "binary";
}

export function parseValueEditorDraft(options: {
  state: ValueEditorState;
  draft: string;
  kind: ValueEditorKind;
  columnType?: string | null;
  nullable: boolean;
}): ValueEditorDraftResult {
  const { state, draft, kind, columnType, nullable } = options;
  if (state === "unloaded") {
    return {
      ok: false,
      error: "Choose Value, Empty string, or NULL before staging a change.",
    };
  }
  if (state === "null") {
    return nullable
      ? { ok: true, value: null }
      : { ok: false, error: "This column does not allow NULL." };
  }
  if (state === "empty") {
    return valueEditorSupportsEmpty(kind)
      ? { ok: true, value: "" }
      : {
          ok: false,
          error: `${kindLabel(kind)} values cannot use the empty-string state.`,
        };
  }

  if (kind === "json") {
    try {
      return { ok: true, value: JSON.parse(draft) };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (kind === "array") {
    const preview = parseArrayPreview(draft);
    if (!preview.ok) return preview;
    // JSON-backed drivers accept a structured array. PostgreSQL-style array
    // literals remain exact strings so inspection never changes bounds,
    // quoting, element types, or server-side casting semantics.
    return draft.trimStart().startsWith("[")
      ? { ok: true, value: preview.value }
      : { ok: true, value: draft };
  }

  if (kind === "binary") {
    if (!draft.startsWith("\\x") && !draft.startsWith("0x")) {
      return {
        ok: false,
        error:
          "Binary values must start with \\x or 0x and contain hexadecimal bytes.",
      };
    }
    const hex = draft.slice(2);
    if (hex.length % 2 !== 0) {
      return {
        ok: false,
        error: "Binary values must contain complete byte pairs.",
      };
    }
    if (!/^[0-9a-f]*$/i.test(hex)) {
      return {
        ok: false,
        error: "Binary values may only contain hexadecimal digits.",
      };
    }
    return { ok: true, value: draft };
  }

  if (kind === "boolean") {
    const normalized = draft.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return { ok: true, value: true };
    }
    if (normalized === "false" || normalized === "0") {
      return { ok: true, value: false };
    }
    return { ok: false, error: "Boolean values must be true or false." };
  }

  if (kind === "number") {
    const normalized = draft.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
      return { ok: false, error: "Enter a valid numeric value." };
    }
    if (INTEGER_TYPE.test(columnType || "")) {
      if (!/^[+-]?\d+$/.test(normalized)) {
        return { ok: false, error: "Enter a whole integer value." };
      }
      const rangeError = integerRangeError(normalized, columnType || "");
      if (rangeError) return { ok: false, error: rangeError };
    }
    // Preserve the exact decimal text. The table mutation layer applies the
    // database column cast without routing large numerics through JS Number.
    return { ok: true, value: normalized };
  }

  if (kind === "date") {
    const normalized = draft.trim();
    if (!isValidTemporalValue(normalized, columnType)) {
      return {
        ok: false,
        error: temporalFormatHint(columnType),
      };
    }
    return { ok: true, value: normalized };
  }

  if (
    UUID_TYPE.test(columnType || "") &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.trim())
  ) {
    return { ok: false, error: "Enter a canonical UUID value." };
  }

  return { ok: true, value: draft };
}

export function formatJsonDraft(
  draft: string,
  compact = false,
): ValueEditorDraftResult {
  try {
    const value = JSON.parse(draft);
    return {
      ok: true,
      value: JSON.stringify(value, null, compact ? undefined : 2),
    };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Parses a JSON draft for the read-only tree presentation. Unlike the staging
 * parser this never changes the draft or reports an editor error by itself.
 */
export function parseJsonPreview(draft: string): JsonPreviewResult {
  if (draft.length > JSON_TREE_PREVIEW_MAX_CHARACTERS) {
    return {
      ok: false,
      error: "JSON is too large for the tree preview. Use the text view instead.",
    };
  }
  try {
    return { ok: true, value: JSON.parse(draft) };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Produces a bounded, read-only tree for JSON arrays and PostgreSQL array
 * literals. It deliberately returns string leaves: only the database can
 * assign element types, and the preview must not coerce precision-sensitive
 * values or rewrite the staged text.
 */
export function parseArrayPreview(draft: string): JsonPreviewResult {
  if (draft.length > JSON_TREE_PREVIEW_MAX_CHARACTERS) {
    return {
      ok: false,
      error: "Array is too large for the tree preview. Use the text view instead.",
    };
  }
  const input = draft.trim();
  const postgresDimensions = /^(?:\[[+-]?\d+:[+-]?\d+\])+=\{/.test(input);
  if (input.startsWith("[") && !postgresDimensions) {
    try {
      const value = JSON.parse(input);
      return Array.isArray(value)
        ? { ok: true, value }
        : { ok: false, error: "The JSON value is not an array." };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON array: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  try {
    return { ok: true, value: parsePostgresArrayLiteral(input) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parsePostgresArrayLiteral(source: string): unknown[] {
  const dimensions = source.startsWith("[") ? source.indexOf("=") : -1;
  let input = source;
  if (dimensions >= 0) {
    const prefix = source.slice(0, dimensions + 1);
    if (!/^(?:\[[+-]?\d+:[+-]?\d+\])+=$/.test(prefix)) {
      throw new Error("Invalid PostgreSQL array dimensions.");
    }
    input = source.slice(dimensions + 1);
  }

  let index = 0;
  let itemCount = 0;
  const parseLevel = (depth: number): unknown[] => {
    if (depth > 64) throw new Error("Array nesting exceeds the 64-level preview limit.");
    if (input[index] !== "{") throw new Error("PostgreSQL arrays must start with '{'.");
    index += 1;
    const values: unknown[] = [];
    if (input[index] === "}") {
      index += 1;
      return values;
    }
    while (index < input.length) {
      if (++itemCount > 100_000) {
        throw new Error("Array exceeds the 100,000-item preview limit.");
      }
      let value: unknown;
      if (input[index] === "{") {
        value = parseLevel(depth + 1);
      } else if (input[index] === '"') {
        index += 1;
        let decoded = "";
        let closed = false;
        while (index < input.length) {
          const character = input[index++]!;
          if (character === "\\") {
            if (index >= input.length) throw new Error("Invalid array escape sequence.");
            decoded += input[index++]!;
          } else if (character === '"') {
            closed = true;
            break;
          } else {
            decoded += character;
          }
        }
        if (!closed) throw new Error("Unterminated quoted array element.");
        value = decoded;
      } else {
        const start = index;
        while (index < input.length && input[index] !== "," && input[index] !== "}") {
          index += 1;
        }
        const token = input.slice(start, index).trim();
        if (!token) throw new Error("Array contains an empty unquoted element.");
        value = token.toUpperCase() === "NULL" ? null : token;
      }
      values.push(value);
      if (input[index] === ",") {
        index += 1;
        continue;
      }
      if (input[index] === "}") {
        index += 1;
        return values;
      }
      throw new Error("Array elements must be separated by ',' and closed with '}'.");
    }
    throw new Error("Unterminated PostgreSQL array literal.");
  };

  const value = parseLevel(0);
  if (index !== input.length) throw new Error("Unexpected text after the array literal.");
  return value;
}

export function binaryByteLength(draft: string) {
  if (!draft.startsWith("\\x") && !draft.startsWith("0x")) return null;
  const hex = draft.slice(2);
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  return hex.length / 2;
}

export function kindLabel(kind: ValueEditorKind) {
  switch (kind) {
    case "json":
      return "JSON";
    case "array":
      return "Array";
    case "date":
      return "Date / time";
    case "binary":
      return "Binary";
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    default:
      return "Text";
  }
}

function isValidTemporalValue(value: string, columnType?: string | null) {
  const type = columnType?.toLowerCase() || "";
  if (type.includes("timestamp") || type.includes("datetime")) {
    const match = value.match(
      /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)$/,
    );
    return Boolean(
      match && isValidCalendarDate(match[1]!) && isValidTimeValue(match[2]!),
    );
  }
  if (/\btime\b/.test(type) || type.includes("timetz")) {
    return isValidTimeValue(value);
  }
  return isValidCalendarDate(value);
}

function isValidCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidTimeValue(value: string) {
  const match = value.match(
    /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:(Z)|([+-])(\d{2})(?::?(\d{2}))?)?$/,
  );
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const zoneHour = Number(match[6] || 0);
  const zoneMinute = Number(match[7] || 0);
  return (
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    zoneHour <= 23 &&
    zoneMinute <= 59
  );
}

function temporalFormatHint(columnType?: string | null) {
  const type = columnType?.toLowerCase() || "";
  if (type.includes("timestamp") || type.includes("datetime")) {
    return "Use YYYY-MM-DD HH:mm:ss, with an optional fractional second and timezone.";
  }
  if (/\btime\b/.test(type) || type.includes("timetz")) {
    return "Use HH:mm:ss, with an optional fractional second and timezone.";
  }
  return "Use YYYY-MM-DD.";
}

function integerRangeError(value: string, columnType: string) {
  const type = columnType.toLowerCase();
  const bitWidth = /\btinyint\b/.test(type)
    ? 8n
    : /\b(?:smallint|int2|smallserial)\b/.test(type)
      ? 16n
      : /\bmediumint\b/.test(type)
        ? 24n
        : /\b(?:bigint|int8|bigserial)\b/.test(type)
          ? 64n
          : 32n;
  const unsigned = /\bunsigned\b/.test(type);
  const parsed = BigInt(value);
  const minimum = unsigned ? 0n : -(2n ** (bitWidth - 1n));
  const maximum = unsigned
    ? 2n ** bitWidth - 1n
    : 2n ** (bitWidth - 1n) - 1n;
  if (parsed < minimum || parsed > maximum) {
    return `Integer is outside the ${unsigned ? "unsigned " : ""}${bitWidth}-bit range.`;
  }
  return null;
}
