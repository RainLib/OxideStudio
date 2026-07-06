import { invoke } from "@tauri-apps/api/core";
import { redactSecrets } from "@/lib/redaction";
import { ApiError, type ApiResponse } from "./types";

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
  args?: Record<string, unknown>
): Promise<T> {
  try {
    const response = await invoke<ApiResponse<T>>(command, args);

    if (response.success && response.data !== undefined) {
      return response.data;
    }

    // 处理错误响应
    const errorMessage = response.error?.message || "Unknown error occurred";
    const errorCode = response.error?.code || "API_ERROR";

    throw new ApiError(errorMessage, errorCode, response.error);
  } catch (error) {
    // 如果已经是我们的错误格式,直接抛出
    if (error instanceof ApiError) {
      throw error;
    }

    // 包装其他错误
    const apiError = new ApiError(
      error instanceof Error ? error.message : String(error),
      "INVOKE_ERROR",
      error
    );

    throw apiError;
  }
}

/**
 * 请求拦截器类型
 */
export type RequestInterceptor = (
  command: string,
  args?: Record<string, unknown>
) => void | Promise<void>;

/**
 * 响应拦截器类型
 */
export type ResponseInterceptor = <T>(
  command: string,
  response: T
) => void | Promise<void>;

/**
 * 错误拦截器类型
 */
export type ErrorInterceptor = (
  command: string,
  error: Error
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
    args?: Record<string, unknown>
  ): Promise<void> {
    for (const interceptor of this.requestInterceptors) {
      await interceptor(command, args);
    }
  }

  async runResponseInterceptors<T>(
    command: string,
    response: T
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
  args?: Record<string, unknown>
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
      error instanceof Error ? error : new Error(String(error))
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
