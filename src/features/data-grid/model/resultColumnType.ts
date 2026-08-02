export type ResultColumnTypeFamily =
  | "number"
  | "boolean"
  | "date"
  | "time"
  | "datetime"
  | "json"
  | "array"
  | "binary"
  | "reference"
  | "string";

const TRANSPARENT_TYPE_WRAPPERS = new Set([
  "nullable",
  "lowcardinality",
  "optional",
]);

const NUMERIC_TYPES = new Set([
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "integer",
  "bigint",
  "serial",
  "smallserial",
  "bigserial",
  "int1",
  "int2",
  "int4",
  "int8",
  "int16",
  "int32",
  "int64",
  "int128",
  "int256",
  "uint",
  "uint8",
  "uint16",
  "uint32",
  "uint64",
  "uint128",
  "uint256",
  "float",
  "float4",
  "float8",
  "float16",
  "float32",
  "float64",
  "real",
  "double",
  "decimal",
  "decimal32",
  "decimal64",
  "decimal128",
  "decimal256",
  "numeric",
  "number",
  "dec",
  "fixed",
  "money",
  "smallmoney",
  "binary_float",
  "binary_double",
]);

function unwrapType(value: string) {
  let normalized = value.trim().toLowerCase();
  let changed = true;

  while (changed && normalized.endsWith(")")) {
    changed = false;
    const openIndex = normalized.indexOf("(");
    if (openIndex <= 0) break;
    const wrapper = normalized.slice(0, openIndex).trim();
    if (!TRANSPARENT_TYPE_WRAPPERS.has(wrapper)) break;
    normalized = normalized.slice(openIndex + 1, -1).trim();
    changed = true;
  }

  return normalized;
}

function baseType(value: string) {
  return unwrapType(value).split(/[\s([<]/, 1)[0] || "";
}

/**
 * Header metadata describes the source column more completely, while the
 * result-set type is the only source available for expressions and arbitrary
 * queries. This mirrors the information hierarchy used by mature database
 * grids without losing cast/expression columns.
 */
export function resolveHeaderColumnType(options: {
  tableColumnType?: string | null;
  resultColumnType?: string | null;
}) {
  const fromTable = options.tableColumnType?.trim();
  if (fromTable) return fromTable;
  const fromResult = options.resultColumnType?.trim();
  return fromResult || undefined;
}

/** Result-set type wins for rendering because a query may cast a source column. */
export function resolveRenderedColumnType(options: {
  resultColumnType?: string | null;
  tableColumnType?: string | null;
}) {
  const fromResult = options.resultColumnType?.trim();
  if (fromResult) return fromResult;
  const fromTable = options.tableColumnType?.trim();
  return fromTable || undefined;
}

export function compactResultColumnType(dataType: string) {
  const value = dataType.trim();
  if (/^enum\s*\(/i.test(value)) return "enum";
  return value;
}

export function resultColumnTypeFamily(
  dataType: string | null | undefined,
): ResultColumnTypeFamily {
  if (!dataType?.trim()) return "string";
  const normalized = unwrapType(dataType);
  const base = baseType(dataType);

  if (NUMERIC_TYPES.has(base)) return "number";
  if (/^(bool|boolean|bit)$/.test(base)) return "boolean";
  if (/^(date)$/.test(base)) return "date";
  if (/^(time|timetz)$/.test(base)) return "time";
  if (/^(datetime|datetime2|smalldatetime|timestamp|timestamptz)$/.test(base)) {
    return "datetime";
  }
  if (/^(json|jsonb|jsonpath|object|map|struct|variant)$/.test(base)) {
    return "json";
  }
  if (
    normalized.endsWith("[]") ||
    /^(array|list|set|tuple)$/.test(base)
  ) {
    return "array";
  }
  if (/^(binary|varbinary|blob|bytea|image)$/.test(base)) return "binary";
  if (/^(uuid|uniqueidentifier|objectid|oid)$/.test(base)) {
    return "reference";
  }
  return "string";
}
