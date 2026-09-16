import type { QueryResult } from "./query";

export interface TablePageResult {
  result: QueryResult;
  page: number;
  pageSize: number;
  totalRows?: number | null;
}

export type TableFilterOperator =
  | "equals"
  | "contains"
  | "startsWith"
  | "endsWith"
  | ">"
  | "<"
  | ">="
  | "<=";

export interface TableFilter {
  column: string;
  operator: TableFilterOperator;
  value: string;
  logic?: "AND" | "OR";
}

export interface TableSort {
  column: string;
  direction: "asc" | "desc";
}

export interface TableRowUpdate {
  key: Record<string, unknown>;
  values: Record<string, unknown>;
  /** Explicit SQL expressions for existing rows. Ordinary values remain parameterized. */
  expressions?: Record<string, string>;
}

export interface TableRowDelete {
  key: Record<string, unknown>;
}

export interface TableMutationResult {
  inserted: number;
  updated: number;
  deleted: number;
  rowsAffected: number;
}
