import { invoke } from "@tauri-apps/api/core";
import { ApiError, type ApiResponse } from "../types";
import type { CommandArguments } from "./contracts";
import { normalizeInvokeError, safeCommandContext } from "./errorNormalization";
import {beginCommandSemanticOperation} from "./semanticOperation";

/** Execute a Tauri command that returns the shared response envelope. */
export async function invokeCommand<T>(
  command: string,
  args?: CommandArguments,
): Promise<T> {
  const finishSemanticOperation=beginCommandSemanticOperation(command,args);
  try {
    const response = await invoke<ApiResponse<T>>(command, args);

    if (response.success && response.data !== undefined) {
      return response.data;
    }

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
    if (error instanceof ApiError) {
      throw error;
    }

    throw normalizeInvokeError(command, args, error);
  } finally {
    finishSemanticOperation();
  }
}

/**
 * Execute a Tauri command whose success value is returned directly rather
 * than wrapped in the shared response envelope.
 */
export async function invokeRawCommand<T>(
  command: string,
  args?: CommandArguments,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeInvokeError(command, args, error);
  }
}
