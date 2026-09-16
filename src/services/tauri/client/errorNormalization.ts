import { ApiError, type ApiErrorPayload } from "../types";
import type { CommandArguments } from "./contracts";

export function normalizeInvokeError(
  command: string,
  args: CommandArguments | undefined,
  error: unknown,
): ApiError {
  if (error instanceof ApiError) return error;
  if (isDesktopInvokeUnavailable(error)) {
    return new ApiError(
      "The OxideStudio desktop backend is unavailable. Open this workspace in the desktop app to connect to databases or use project tools.",
      "TAURI_RUNTIME_UNAVAILABLE",
      error,
      {
        retryable: false,
        category: "application",
        context: safeCommandContext(args),
        command,
      },
    );
  }
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

/**
 * `@tauri-apps/api` throws this otherwise opaque TypeError when Vite is opened
 * in a normal browser rather than inside Tauri. Surface a recoverable product
 * state instead of leaking an implementation detail into Database Explorer.
 */
function isDesktopInvokeUnavailable(error: unknown) {
  return (
    error instanceof TypeError &&
    /(?:cannot read propert(?:y|ies).*invoke|reading ['"]invoke['"])/iu.test(
      error.message,
    )
  );
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
    command.includes("schema_migration") ||
    command.includes("schema_snapshot") ||
    /^(?:get|refresh|set_current)_(?:database_|cached_)?(?:databases|schemas|tables|collections|columns|indexes|constraints|referencing_foreign_keys|functions|schema)/.test(
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

export function safeCommandContext(args?: CommandArguments) {
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
    "transferId",
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
