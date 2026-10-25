import type { CsvHeader, FileQueryFormat, FileQuerySession } from "@/services/tauri/file-query.service";
import type { ColumnDef } from "@/services/tauri/types";

export type FileQuerySource = { kind: "picker"; projectId: string } | {
  kind: "project"; projectId: string; expectedRoot: string; relativePath: string;
};
export interface FileQueryDocument {
  source: FileQuerySource;
  session: FileQuerySession | null;
  driverId: string;
  packageVersion: string;
  csvHeader: CsvHeader;
  schema?: ColumnDef[];
}
export function fileQueryFormat(path: string): FileQueryFormat | null {
  const parts = path.split(".");
  const extension = parts.length > 1 ? parts.pop()?.toLowerCase() : undefined;
  return extension && ["csv", "json", "jsonl", "parquet"].includes(extension) ? extension as FileQueryFormat : null;
}

export type FileQueryFormatResult = { ok: true } | { ok: false; error: unknown };
