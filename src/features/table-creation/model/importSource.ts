import type { TableImportFormat } from "@/services/tauri";

export function importFormatForPath(filePath: string): TableImportFormat | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (["csv", "tsv", "txt"].includes(extension || "")) return "csv";
  if (["json", "jsonl", "ndjson"].includes(extension || "")) return "json";
  if (extension === "xlsx") return "xlsx";
  return null;
}

export function importTableNameSuggestion(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() || "imported_data";
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");
  const normalized = withoutExtension
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "imported_data";
}
