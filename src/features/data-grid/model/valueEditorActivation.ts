import { resultColumnTypeFamily } from "./resultColumnType";

const LONG_TEXT_ACTIVATION_LENGTH = 160;

/** Route values that cannot be edited safely in a small canvas overlay to the full editor. */
export function dataGridCellUsesFullValueEditor(
  value: unknown,
  dataType: string | null | undefined,
): boolean {
  const family = resultColumnTypeFamily(dataType);
  if (family === "json" || family === "array" || family === "binary") return true;
  if (typeof value === "object" && value !== null) return true;
  if (typeof value !== "string") return false;
  return value.length > LONG_TEXT_ACTIVATION_LENGTH || /[\r\n]/u.test(value);
}
