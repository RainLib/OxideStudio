import type {
  TableCsvImportOptions,
  TableImportFormat,
} from "@/services/tauri";

export interface CreateTableColumn {
  name: string;
  type: string;
  length: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
  comment: string;
}

export interface TableImportSource {
  filePath: string;
  format: TableImportFormat;
  contentDigest: string;
  totalRows: number;
  csvOptions?: TableCsvImportOptions | null;
}

export interface CreateTableColumnDragState {
  isDragging: boolean;
  dragIndex: number | null;
  hoverIndex: number | null;
}
