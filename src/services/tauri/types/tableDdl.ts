export interface CreateTableColumn {
  name: string;
  dataType: string;
  length?: string | null;
  isPrimaryKey: boolean;
  isNotNull: boolean;
  isAutoIncrement: boolean;
  comment?: string | null;
}

export type AlterColumnValueMode = "keep" | "set" | "drop";

export interface AlterTableColumn {
  name: string;
  dataType?: string | null;
  length?: string | null;
  isNotNull?: boolean | null;
  defaultMode?: AlterColumnValueMode | null;
  defaultValue?: string | null;
  commentMode?: AlterColumnValueMode | null;
  comment?: string | null;
}

export interface CreateTableResult {
  table: string;
  statements: string[];
}

export interface CreateViewResult {
  view: string;
  statement: string;
}

export interface CreateMaterializedViewResult {
  view: string;
  statement: string;
}

export interface TableColumnChangeResult {
  table: string;
  column: string;
  statements: string[];
}

export interface TableIndexChangeResult {
  table: string;
  index: string;
  statements: string[];
}

export interface TableConstraintChangeResult {
  table: string;
  constraint: string;
  statements: string[];
}
