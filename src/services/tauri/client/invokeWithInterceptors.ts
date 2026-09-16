import type { CommandArguments } from "./contracts";
import { interceptors } from "./interceptors";
import { invokeCommand } from "./invoke";

/** Execute an envelope-backed command with the global interceptor lifecycle. */
export async function invokeWithInterceptors<T>(
  command: string,
  args?: CommandArguments,
): Promise<T> {
  try {
    await interceptors.runRequestInterceptors(command, args);
    const response = await invokeCommand<T>(command, args);
    await interceptors.runResponseInterceptors(command, response);
    return response;
  } catch (error) {
    await interceptors.runErrorInterceptors(
      command,
      error instanceof Error ? error : new Error(String(error)),
    );

    throw error;
  }
}
