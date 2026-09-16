import type {
  CommandArguments,
  ErrorInterceptor,
  RequestInterceptor,
  ResponseInterceptor,
} from "./contracts";

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
    args?: CommandArguments,
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

/** Shared interceptor lifecycle for every envelope-backed Tauri command. */
export const interceptors = new InterceptorManager();
