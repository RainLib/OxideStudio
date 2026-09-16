/**
 * Tauri API 类型定义
 * 所有与 Rust 后端交互的类型定义
 */

/**
 * 通用响应类型
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiErrorPayload;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  retryable?: boolean;
  category?: string;
  context?: Record<string, unknown>;
}

/**
 * API 错误类
 */
export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly category?: string;
  readonly context: Record<string, unknown>;
  readonly command?: string;

  constructor(
    message: string,
    code = "API_ERROR",
    public originalError?: unknown,
    details: {
      retryable?: boolean;
      category?: string;
      context?: Record<string, unknown>;
      command?: string;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = details.retryable ?? false;
    this.category = details.category;
    this.context = details.context || {};
    this.command = details.command;
  }
}
