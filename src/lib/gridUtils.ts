import { GridCellKind, GridCell } from "@glideapps/glide-data-grid";

export type DataType = "null" | "number" | "boolean" | "date" | "string";

/**
 * Detect the data type of a value
 */
export function detectDataType(value: any): DataType {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";

  // Try to detect date strings
  if (typeof value === "string") {
    const datePattern = /^\d{4}-\d{2}-\d{2}([T\s]\d{2}:\d{2}:\d{2})?/;
    if (datePattern.test(value)) return "date";
  }

  return "string";
}

/**
 * Format a value for display based on its type
 */
export function formatValue(value: any, type?: DataType): string {
  const detectedType = type || detectDataType(value);

  switch (detectedType) {
    case "null":
      return "NULL";
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    case "boolean":
      return value ? "✓ true" : "✗ false";
    case "date":
      try {
        const date = new Date(value);
        return date.toLocaleString();
      } catch {
        return String(value);
      }
    default:
      return String(value);
  }
}

/**
 * Create a GridCell with proper styling based on data type
 */
export function createTypedCell(value: any, allowOverlay = true): GridCell {
  const type = detectDataType(value);
  const displayData = formatValue(value, type);

  // Color coding for different types
  const themeOverride = (() => {
    switch (type) {
      case "null":
        return {
          textDark: "#6b7280", // gray-500
          fontStyle: "italic",
        };
      case "number":
        return {
          textDark: "#60a5fa", // blue-400
        };
      case "boolean":
        return {
          textDark: value ? "#34d399" : "#f87171", // green-400 or red-400
        };
      case "date":
        return {
          textDark: "#a78bfa", // purple-400
        };
      default:
        return undefined;
    }
  })();

  return {
    kind: GridCellKind.Text,
    allowOverlay,
    displayData,
    data: String(value),
    themeOverride,
    contentAlign: type === "number" ? "right" : "left",
  };
}

/**
 * Filter data based on column filters
 */
export interface FilterState {
  operator: "equals" | "contains" | "startsWith" | "endsWith" | "gt" | "lt";
  value: string;
}

export function applyFilter(rowValue: any, filter: FilterState): boolean {
  if (!filter.value) return true;

  const searchValue = filter.value.toLowerCase();
  const cellValue = String(rowValue).toLowerCase();

  switch (filter.operator) {
    case "equals":
      return cellValue === searchValue;
    case "contains":
      return cellValue.includes(searchValue);
    case "startsWith":
      return cellValue.startsWith(searchValue);
    case "endsWith":
      return cellValue.endsWith(searchValue);
    case "gt":
      return Number(rowValue) > Number(filter.value);
    case "lt":
      return Number(rowValue) < Number(filter.value);
    default:
      return true;
  }
}

/**
 * Sort comparator for grid data
 */
export function compareValues(
  a: any,
  b: any,
  direction: "asc" | "desc"
): number {
  // Handle null values
  if (a === null || a === undefined) return direction === "asc" ? -1 : 1;
  if (b === null || b === undefined) return direction === "asc" ? 1 : -1;

  // Numeric comparison
  if (typeof a === "number" && typeof b === "number") {
    return direction === "asc" ? a - b : b - a;
  }

  // String comparison
  const aStr = String(a).toLowerCase();
  const bStr = String(b).toLowerCase();

  if (direction === "asc") {
    return aStr.localeCompare(bStr);
  } else {
    return bStr.localeCompare(aStr);
  }
}
