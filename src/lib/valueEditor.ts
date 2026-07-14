export type ValueEditorKind =
  "text" | "json" | "date" | "binary" | "number" | "boolean";

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

const JSON_TYPE = /\b(jsonb?|object|map|document)\b/i;
const BINARY_TYPE =
  /\b(bytea|binary|varbinary|tinyblob|blob|mediumblob|longblob|raw)\b/i;
const DATE_TYPE = /\b(date|time|timestamp|datetime|timestamptz|timetz)\b/i;
const NUMBER_TYPE =
  /\b(int|serial|decimal|numeric|real|double|float|money|number)\b/i;
const BOOLEAN_TYPE = /\b(bool|boolean)\b/i;

export function inferValueEditorKind(
  columnType: string | null | undefined,
  value: unknown,
): ValueEditorKind {
  const normalizedType = columnType?.trim() || "";
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
