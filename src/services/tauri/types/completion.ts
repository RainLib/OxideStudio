/**
 * SQL 自动完成上下文
 */
export type CompletionType = "table" | "column" | "keyword" | "none";

export interface CompletionContext {
  suggestionType: CompletionType;
  relevantTable?: string;
  candidates?: string[];
  matchString?: string;
}

/**
 * SQL 自动完成请求参数
 */
export interface CompletionRequest {
  sql: string;
  cursor: number;
}
