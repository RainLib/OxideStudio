import { invoke } from "@tauri-apps/api/core";
import { redactSecrets } from "@/lib/redaction";
import { ApiError, type ApiErrorPayload, type ApiResponse } from "./types";

/**
 * 基础 API 客户端
 * 封装所有 Tauri invoke 调用,提供统一的错误处理
 */

/**
 * 执行 Tauri 命令
 * @param command - 命令名称
 * @param args - 命令参数
 * @returns Promise<T> - 命令执行结果
 * @throws {ApiError} - 如果命令执行失败
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    const response = await invoke<ApiResponse<T>>(command, args);

    if (response.success && response.data !== undefined) {
      return response.data;
    }

    // 处理错误响应
    const payload = response.error;
    throw new ApiError(
      payload?.message || "Unknown error occurred",
      payload?.code || "API_ERROR",
      payload,
      {
        retryable: payload?.retryable,
        category: payload?.category,
        context: {
          ...safeCommandContext(args),
          ...(payload?.context || {}),
        },
        command,
      },
    );
  } catch (error) {
    // 如果已经是我们的错误格式,直接抛出
    if (error instanceof ApiError) {
      throw error;
    }

    throw normalizeInvokeError(command, args, error);
  }
}

/**
 * Execute a Tauri command whose success value is returned directly rather
 * than wrapped in the shared Response envelope. Rejections still use the
 * same structured ApiError contract as invokeCommand.
 */
export async function invokeRawCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeInvokeError(command, args, error);
  }
}

export function normalizeInvokeError(
  command: string,
  args: Record<string, unknown> | undefined,
  error: unknown,
): ApiError {
  if (error instanceof ApiError) return error;
  const payload = structuredErrorPayload(error);
  const code = payload?.code || commandFailureCode(command);
  const message =
    payload?.message ||
    (error instanceof Error
      ? error.message
      : String(error || "Command failed"));
  return new ApiError(message, code, error, {
    retryable: payload?.retryable ?? error instanceof Error,
    category: payload?.category || commandCategory(command),
    context: {
      ...safeCommandContext(args),
      ...(payload?.context || {}),
    },
    command,
  });
}

function structuredErrorPayload(error: unknown): ApiErrorPayload | null {
  if (!error || typeof error !== "object" || error instanceof Error)
    return null;
  const value = error as Record<string, unknown>;
  if (typeof value.code !== "string" || typeof value.message !== "string") {
    return null;
  }
  return {
    code: value.code,
    message: value.message,
    retryable:
      typeof value.retryable === "boolean" ? value.retryable : undefined,
    category: typeof value.category === "string" ? value.category : undefined,
    context: isRecord(value.context) ? value.context : undefined,
  };
}

function commandFailureCode(command: string) {
  const category = commandCategory(command);
  if (category === "application") return "INVOKE_ERROR";
  return `${category.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}_COMMAND_FAILED`;
}

function commandCategory(command: string) {
  if (
    /(?:^|_)(?:connect|connection|disconnect)(?:_|$)/.test(command) ||
    command === "load_connections" ||
    command === "save_connections"
  ) {
    return "connection";
  }
  if (
    command.startsWith("execute_query") ||
    command.startsWith("execute_read_only_query") ||
    command.startsWith("cancel_query") ||
    command === "get_sql_completion"
  ) {
    return "query";
  }
  if (
    /^(?:get|refresh|set_current)_(?:database_|cached_)?(?:databases|schemas|tables|collections|columns|indexes|constraints|functions|schema)/.test(
      command,
    )
  ) {
    return "schema";
  }
  if (
    command.includes("table") ||
    command.includes("view") ||
    command.includes("column") ||
    command.includes("constraint")
  ) {
    return "table";
  }
  if (command.includes("project") || command.includes("file")) {
    return "projectFile";
  }
  return "application";
}

function safeCommandContext(args?: Record<string, unknown>) {
  if (!args) return {};
  const context: Record<string, unknown> = {};
  for (const key of [
    "projectId",
    "connectionId",
    "driver",
    "database",
    "schema",
    "namespace",
    "table",
    "view",
    "queryId",
    "relativePath",
    "newRelativePath",
  ]) {
    const value =
      args[key] ?? (isRecord(args.request) ? args.request[key] : undefined);
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      context[key] = value;
    }
  }
  return context;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 请求拦截器类型
 */
export type RequestInterceptor = (
  command: string,
  args?: Record<string, unknown>,
) => void | Promise<void>;

/**
 * 响应拦截器类型
 */
export type ResponseInterceptor = <T>(
  command: string,
  response: T,
) => void | Promise<void>;

/**
 * 错误拦截器类型
 */
export type ErrorInterceptor = (
  command: string,
  error: Error,
) => void | Promise<void>;

/**
 * 拦截器管理器
 */
class InterceptorManager {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private errorInterceptors: ErrorInterceptor[] = [];

  addRequestInterceptor(interceptor: RequestInterceptor): void {
    this.requestInterceptors.push(interceptor);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  addErrorInterceptor(interceptor: ErrorInterceptor): void {
    this.errorInterceptors.push(interceptor);
  }

  async runRequestInterceptors(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<void> {
    for (const interceptor of this.requestInterceptors) {
      await interceptor(command, args);
    }
  }

  async runResponseInterceptors<T>(
    command: string,
    response: T,
  ): Promise<void> {
    for (const interceptor of this.responseInterceptors) {
      await interceptor(command, response);
    }
  }

  async runErrorInterceptors(command: string, error: Error): Promise<void> {
    for (const interceptor of this.errorInterceptors) {
      await interceptor(command, error);
    }
  }
}

/**
 * 全局拦截器管理器实例
 */
export const interceptors = new InterceptorManager();

/**
 * 带拦截器的命令执行
 */
export async function invokeWithInterceptors<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    // 执行请求拦截器
    await interceptors.runRequestInterceptors(command, args);

    // 执行命令
    const response = await invokeCommand<T>(command, args);

    // 执行响应拦截器
    await interceptors.runResponseInterceptors(command, response);

    return response;
  } catch (error) {
    // 执行错误拦截器
    await interceptors.runErrorInterceptors(
      command,
      error instanceof Error ? error : new Error(String(error)),
    );

    throw error;
  }
}

/**
 * 添加默认的日志拦截器
 */
if (import.meta.env.DEV) {
  interceptors.addRequestInterceptor((command, args) => {
    console.log(`[API Request] ${command}`, redactSecrets(args));
  });

  interceptors.addResponseInterceptor((command, response) => {
    console.log(`[API Response] ${command}`, response);
  });

  interceptors.addErrorInterceptor((command, error) => {
    console.error(`[API Error] ${command}`, error);
  });
}
