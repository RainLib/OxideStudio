import type { DatabaseDriver } from "@/services/tauri/types";
import { quoteIdentifier } from "@/lib/databaseDialect";

/** Small, previewable text transforms for SQL editing commands. They avoid
 * parsing whole statements and return null when a selection is ambiguous. */
export function quoteSqlIdentifierSelection(
  driver: DatabaseDriver,
  selection: string,
): string | null {
  const parts = selection.trim().split(".");
  if (
    parts.length === 0 ||
    parts.some((part) => !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(part))
  ) {
    return null;
  }
  return parts.map((part) => quoteIdentifier(driver, part)).join(".");
}

export function unquoteSqlIdentifierSelection(selection: string): string | null {
  const parts = selection.trim().split(".");
  if (parts.length === 0) return null;
  const unquoted = parts.map((part) => {
    if (/^"(?:[^"]|"")+"$/.test(part)) {
      return part.slice(1, -1).replaceAll('""', '"');
    }
    if (/^`[^`]+`$/.test(part)) return part.slice(1, -1).replaceAll("``", "`");
    if (/^\[[^\]]+\]$/.test(part)) return part.slice(1, -1).replaceAll("]]", "]");
    return null;
  });
  return unquoted.some((part) => part === null) ? null : unquoted.join(".");
}

/** Converts a clipboard column into SQL literals suitable for the current
 * IN-list cursor. Values are local-only and never sent to LSP or an agent. */
export function sqlInListFromClipboard(clipboard: string): string | null {
  const values = clipboard
    .split(/[\r\n,\t]+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0 || values.length > 1_000) return null;
  const literals = values.map((value) => {
    if (/^null$/i.test(value)) return "NULL";
    if (/^(true|false)$/i.test(value)) return value.toUpperCase();
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return value;
    return `'${value.replaceAll("'", "''")}'`;
  });
  return `(${literals.join(", ")})`;
}
