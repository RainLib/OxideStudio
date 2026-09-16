import { GridColumnIcon } from "@glideapps/glide-data-grid";

import { resultColumnTypeFamily } from "@/features/data-grid/model/resultColumnType";

export function rangeIndexes(start: number, length: number) {
  return Array.from({ length }, (_, index) => start + index);
}

export function exportFilename(
  title: string | undefined,
  extension: "csv" | "json" | "jsonl" | "md" | "tsv" | "sql",
) {
  const safeTitle = (title || "query-result")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeTitle || "query-result"}.${extension}`;
}

export function columnIconForType(type: string, isPrimaryKey?: boolean) {
  if (isPrimaryKey) return GridColumnIcon.HeaderRowID;

  switch (resultColumnTypeFamily(type)) {
    case "number":
      return GridColumnIcon.HeaderNumber;
    case "boolean":
      return GridColumnIcon.HeaderBoolean;
    case "date":
    case "datetime":
      return GridColumnIcon.HeaderDate;
    case "time":
      return GridColumnIcon.HeaderTime;
    case "json":
    case "binary":
      return GridColumnIcon.HeaderCode;
    case "array":
      return GridColumnIcon.HeaderArray;
    case "reference":
      return GridColumnIcon.HeaderReference;
    default:
      return GridColumnIcon.HeaderString;
  }
}

export function cssHslVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value ? `hsl(${value})` : fallback;
}

export function cssHslVarAlpha(name: string, alpha: number, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value ? `hsl(${value} / ${alpha})` : fallback;
}

export function drawTruncatedHeaderText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maximumWidth: number,
) {
  if (!text || maximumWidth <= 0) return;
  if (context.measureText(text).width <= maximumWidth) {
    context.fillText(text, x, y);
    return;
  }
  const ellipsis = "…";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (
      context.measureText(`${text.slice(0, middle)}${ellipsis}`).width <=
      maximumWidth
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  context.fillText(`${text.slice(0, low)}${ellipsis}`, x, y);
}
