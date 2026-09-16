export type CommandArguments = Record<string, unknown>;

/** Request interceptors run before the Tauri command is dispatched. */
export type RequestInterceptor = (
  command: string,
  args?: CommandArguments,
) => void | Promise<void>;

/** Response interceptors observe successful command payloads. */
export type ResponseInterceptor = <T>(
  command: string,
  response: T,
) => void | Promise<void>;

/** Error interceptors observe failures from any dispatch lifecycle stage. */
export type ErrorInterceptor = (
  command: string,
  error: Error,
) => void | Promise<void>;
