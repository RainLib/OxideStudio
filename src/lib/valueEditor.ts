export type ValueEditorKind =
  | "text"
  | "json"
  | "xml"
  | "map"
  | "array"
  | "image"
  | "geometry"
  | "date"
  | "binary"
  | "number"
  | "boolean";

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

const JSON_TYPE = /\b(jsonb?|object|document)\b/i;
const XML_TYPE = /\b(xml|xmltype|sqlxml)\b/i;
const MAP_TYPE = /\b(hstore|map)\b/i;
const ARRAY_TYPE = /(?:\[\]\s*$|\barray\b)/i;
const IMAGE_TYPE = /\b(image|picture)\b/i;
const GEOMETRY_TYPE = /\b(geometry|geography|point|linestring|polygon|multipolygon|multilinestring|multipoint)\b/i;
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
  if (MAP_TYPE.test(normalizedType)) return "map";
  if (XML_TYPE.test(normalizedType)) return "xml";
  if (IMAGE_TYPE.test(normalizedType)) return "image";
  if (GEOMETRY_TYPE.test(normalizedType)) return "geometry";
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
  if (kind === "json" || (kind === "map" && typeof value === "object")) {
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

  // XML is retained as source text. The preview parser below is deliberately
  // inspection-only: it does not normalize entities, namespaces, whitespace,
  // or a database-specific XML representation before staging the update.
  if (kind === "xml") return { ok: true, value: draft };
  if (kind === "image" || kind === "geometry") return { ok: true, value: draft };

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

/**
 * Parses map-shaped cells strictly for the read-only tree. Staging preserves
 * the source text because hstore-like syntaxes have database-specific casts
 * and escaping rules that the application must not rewrite.
 */
export function parseMapPreview(draft: string): JsonPreviewResult {
  if (draft.length > JSON_TREE_PREVIEW_MAX_CHARACTERS) {
    return {
      ok: false,
      error: "Map value is too large for the tree preview. Use the text view instead.",
    };
  }
  const input = draft.trim();
  if (input.startsWith("{")) {
    try {
      const value = JSON.parse(input);
      return value && !Array.isArray(value) && typeof value === "object"
        ? { ok: true, value }
        : { ok: false, error: "The JSON value is not an object map." };
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON map: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  try {
    return { ok: true, value: parseHstoreLiteral(input) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Bounded XML tokenizer for the read-only value tree. This is intentionally
 * not a DOM parser: no external entities, DTDs, stylesheets, or network work
 * can be activated while inspecting a database cell.
 */
export function parseXmlPreview(draft: string): JsonPreviewResult {
  if (draft.length > JSON_TREE_PREVIEW_MAX_CHARACTERS) {
    return { ok: false, error: "XML is too large for the tree preview. Use the text view instead." };
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(draft)) {
    return { ok: false, error: "XML declarations with DTD or entity definitions are not shown in the tree preview." };
  }
  const root: { elements: unknown[] } = { elements: [] };
  const stack: Array<{ name: string; node: Record<string, unknown>; children: unknown[] }> = [];
  const token = /<([^>]+)>|([^<]+)/g;
  let cursor = 0;
  let nodes = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(draft))) {
    if (match.index !== cursor) return { ok: false, error: "Invalid XML markup." };
    cursor = token.lastIndex;
    const markup = match[1];
    const text = match[2];
    if (text !== undefined) {
      const value = text.trim();
      if (value) {
        if (!stack.length) return { ok: false, error: "Text must be contained by an XML element." };
        stack[stack.length - 1]!.children.push({ "#text": value });
      }
      continue;
    }
    const source = markup!.trim();
    if (source.startsWith("?") || source.startsWith("!--")) continue;
    if (source.startsWith("/")) {
      const name = source.slice(1).trim();
      const open = stack.pop();
      if (!open || open.name !== name) return { ok: false, error: `Mismatched XML closing tag: ${name}.` };
      continue;
    }
    if (source.startsWith("!")) return { ok: false, error: "Unsupported XML declaration in tree preview." };
    const selfClosing = source.endsWith("/");
    const element = (selfClosing ? source.slice(0, -1) : source).trim();
    const name = element.match(/^([A-Za-z_][\w:.-]*)/);
    if (!name) return { ok: false, error: "Invalid XML element name." };
    if (++nodes > 100_000) return { ok: false, error: "XML exceeds the 100,000-node preview limit." };
    const attributes: Record<string, string> = {};
    const attributeSource = element.slice(name[0].length).trim();
    const attribute = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attributeMatch: RegExpExecArray | null;
    let attributeCursor = 0;
    while ((attributeMatch = attribute.exec(attributeSource))) {
      if (!/^\s*$/.test(attributeSource.slice(attributeCursor, attributeMatch.index))) {
        return { ok: false, error: "Invalid XML attribute syntax." };
      }
      attributes[attributeMatch[1]!] = attributeMatch[2] ?? attributeMatch[3] ?? "";
      attributeCursor = attribute.lastIndex;
    }
    if (!/^\s*$/.test(attributeSource.slice(attributeCursor))) {
      return { ok: false, error: "Invalid XML attribute syntax." };
    }
    const children: unknown[] = [];
    const node: Record<string, unknown> = Object.keys(attributes).length ? { "@attributes": attributes, children } : { children };
    const wrapped = { [name[0]]: node };
    const parent = stack[stack.length - 1];
    (parent ? parent.children : root.elements).push(wrapped);
    if (!selfClosing) {
      if (stack.length >= 64) return { ok: false, error: "XML nesting exceeds the 64-level preview limit." };
      stack.push({ name: name[0], node, children });
    }
  }
  if (cursor !== draft.length || stack.length) return { ok: false, error: "Unclosed or invalid XML element." };
  if (root.elements.length !== 1) return { ok: false, error: "XML requires exactly one root element." };
  return { ok: true, value: root.elements[0] };
}

export type ImagePreviewResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

/**
 * Accept only inert, raster data URLs. In particular SVG is intentionally not
 * accepted because database content must not become executable document
 * markup inside the desktop renderer.
 */
export function parseImagePreview(draft: string): ImagePreviewResult {
  const value = draft.trim();
  if (value.length > 8 * 1024 * 1024) {
    return { ok: false, error: "Image source is too large for the inline preview." };
  }
  const match = value.match(/^data:image\/(png|jpeg|gif|webp|bmp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return {
      ok: false,
      error: "Use a raster data URL (PNG, JPEG, GIF, WebP, or BMP) to preview this image value.",
    };
  }
  const payload = match[2]!.replace(/\s/g, "");
  if (payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    return { ok: false, error: "Image data URL contains invalid base64 data." };
  }
  return { ok: true, dataUrl: `data:image/${match[1]!.toLowerCase()};base64,${payload}` };
}

/**
 * Provides structural, read-only WKT inspection without invoking a geometry
 * library or changing the database's original textual representation.
 */
export function parseGeometryPreview(draft: string): JsonPreviewResult {
  if (draft.length > JSON_TREE_PREVIEW_MAX_CHARACTERS) {
    return { ok: false, error: "Geometry is too large for the tree preview. Use the text view instead." };
  }
  const source = draft.trim();
  const match = source.match(/^(?:SRID=(\d+);)?\s*(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*(EMPTY|\(.+\))$/i);
  if (!match) return { ok: false, error: "Expected WKT geometry text (for example POINT(1 2))." };
  const body = match[3]!.toUpperCase() === "EMPTY" ? "" : match[3]!;
  const coordinateTokens = body.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi) || [];
  if (coordinateTokens.length > 100_000) {
    return { ok: false, error: "Geometry exceeds the 100,000-coordinate preview limit." };
  }
  let currentDepth = 0;
  let depth = 0;
  for (const character of body) {
    if (character === "(") currentDepth += 1;
    if (character === ")") currentDepth -= 1;
    depth = Math.max(depth, currentDepth);
  }
  if (depth > 64) return { ok: false, error: "Geometry nesting exceeds the 64-level preview limit." };
  if (body && !balancedGeometryParens(body)) return { ok: false, error: "Geometry parentheses are unbalanced." };
  return {
    ok: true,
    value: {
      type: match[2]!.toUpperCase(),
      ...(match[1] ? { srid: match[1] } : {}),
      empty: body.length === 0,
      coordinateCount: coordinateTokens.length,
      coordinates: coordinateTokens.slice(0, 128),
      ...(coordinateTokens.length > 128 ? { coordinatesTruncated: true } : {}),
    },
  };
}

function balancedGeometryParens(source: string) {
  let depth = 0;
  for (const character of source) {
    if (character === "(") depth += 1;
    if (character === ")" && --depth < 0) return false;
  }
  return depth === 0;
}

function parseHstoreLiteral(source: string): Record<string, string | null> {
  let index = 0;
  let pairCount = 0;
  const result: Record<string, string | null> = {};

  const skipSpace = () => {
    while (/\s/.test(source[index] || "")) index += 1;
  };
  const readQuoted = () => {
    index += 1;
    let value = "";
    while (index < source.length) {
      const char = source[index++]!;
      if (char === "\\") {
        if (index >= source.length) throw new Error("Invalid hstore escape sequence.");
        value += source[index++]!;
      } else if (char === '"') {
        return value;
      } else {
        value += char;
      }
    }
    throw new Error("Unterminated quoted hstore value.");
  };
  const readToken = (terminator: "=>" | ",") => {
    skipSpace();
    if (source[index] === '"') return readQuoted();
    const start = index;
    while (index < source.length && !source.startsWith(terminator, index)) index += 1;
    const value = source.slice(start, index).trim();
    if (!value) throw new Error("hstore contains an empty unquoted value.");
    return value;
  };

  skipSpace();
  if (!source) return result;
  while (index < source.length) {
    if (++pairCount > 100_000) throw new Error("Map exceeds the 100,000-entry preview limit.");
    const key = readToken("=>");
    if (!source.startsWith("=>", index)) throw new Error("hstore entries must use => between key and value.");
    index += 2;
    skipSpace();
    const value = source.slice(index, index + 4).toUpperCase() === "NULL" &&
      !/[A-Za-z0-9_]/.test(source[index + 4] || "")
      ? (index += 4, null)
      : readToken(",");
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`hstore contains duplicate key ${JSON.stringify(key)}.`);
    }
    result[key] = value;
    skipSpace();
    if (index >= source.length) return result;
    if (source[index] !== ",") throw new Error("hstore entries must be separated by commas.");
    index += 1;
    skipSpace();
    if (index >= source.length) throw new Error("hstore cannot end with a comma.");
  }
  return result;
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
    case "xml":
      return "XML";
    case "map":
      return "Map";
    case "array":
      return "Array";
    case "image":
      return "Image";
    case "geometry":
      return "Geometry";
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
