import type { DatabaseDriver } from "./database";

/**
 * 列定义
 */
export interface ColumnDef {
  name: string;
  data_type: string;
}

/**
 * 查询结果
 */
export interface QueryResult {
  columns: ColumnDef[];
  rows: any[][];
  truncated?: boolean;
  rowLimit?: number;
  rowsAffected?: number;
  statementType?: string;
  message?: string;
  responseMeta?: QueryResponseMeta;
}

/**
 * A page backed by a live driver cursor. `nextCursor` is opaque and valid only
 * for the connection that returned it; callers must close it when abandoning
 * the result view.
 */
export interface NativeQueryPage {
  result: QueryResult;
  nextCursor?: string | null;
}

export interface QueryResponseMeta {
  requestMethod: string;
  requestPath: string;
  status: number;
  durationMs: number;
  rawResponse: unknown;
}

export type ExplainPlanMode = "estimate" | "analyze";

export type ExplainPlanFormat = "json" | "text";

export interface ExplainPlanNode {
  id: string;
  nodeType: string;
  relation?: string | null;
  alias?: string | null;
  accessType?: string | null;
  joinType?: string | null;
  index?: string | null;
  condition?: string | null;
  startupCost?: number | null;
  totalCost?: number | null;
  estimatedRows?: number | null;
  actualStartupTimeMs?: number | null;
  actualTotalTimeMs?: number | null;
  actualRows?: number | null;
  loops?: number | null;
  children: ExplainPlanNode[];
}

export interface ExplainPlan {
  id: string;
  driver: DatabaseDriver;
  mode: ExplainPlanMode;
  format: ExplainPlanFormat;
  generatedInMs: number;
  planningTimeMs?: number | null;
  executionTimeMs?: number | null;
  totalCost?: number | null;
  estimatedRows?: number | null;
  root: ExplainPlanNode;
  rawPlan: unknown;
  warnings: string[];
}

export interface ExplainQueryRequest {
  connectionId: string;
  sql: string;
  schema?: string;
  database?: string;
  queryId: string;
  mode: ExplainPlanMode;
}
