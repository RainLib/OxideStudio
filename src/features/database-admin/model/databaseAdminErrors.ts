export type DatabaseAdminErrorKind =
  | "permissionDenied"
  | "connectionUnavailable"
  | "unsupported"
  | "validation"
  | "queryFailed";

export interface DatabaseAdminErrorPresentation {
  kind: DatabaseAdminErrorKind;
  title: string;
  message: string;
  guidance?: string;
  retryable: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function errorKind(error: unknown): DatabaseAdminErrorKind {
  const value = record(error);
  const context = record(value?.context);
  const explicitKind = context?.adminErrorKind;
  if (
    explicitKind === "permissionDenied" ||
    explicitKind === "connectionUnavailable" ||
    explicitKind === "unsupported" ||
    explicitKind === "validation" ||
    explicitKind === "queryFailed"
  ) {
    return explicitKind;
  }

  const code = typeof value?.code === "string" ? value.code : "";
  if (code.endsWith("_PERMISSION_DENIED")) return "permissionDenied";
  if (code.endsWith("_CONNECTION_UNAVAILABLE")) return "connectionUnavailable";
  if (code.endsWith("_UNSUPPORTED")) return "unsupported";
  if (code.endsWith("_VALIDATION_FAILED")) return "validation";
  return "queryFailed";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const value = record(error);
  if (typeof value?.message === "string" && value.message.trim()) {
    return value.message;
  }
  return "The database administration request failed.";
}

export function databaseAdminErrorPresentation(
  error: unknown,
): DatabaseAdminErrorPresentation {
  const kind = errorKind(error);
  const message = errorMessage(error);
  switch (kind) {
    case "permissionDenied":
      return {
        kind,
        title: "Permission required",
        message,
        guidance:
          "Use an account allowed to read the selected administration view or perform this action.",
        retryable: false,
      };
    case "connectionUnavailable":
      return {
        kind,
        title: "Connection unavailable",
        message,
        guidance: "Reconnect the data source before retrying.",
        retryable: true,
      };
    case "unsupported":
      return {
        kind,
        title: "Capability unavailable",
        message,
        guidance:
          "This server version or driver does not expose the required reviewed administration protocol.",
        retryable: false,
      };
    case "validation":
      return {
        kind,
        title: "Request rejected",
        message,
        retryable: false,
      };
    default:
      return {
        kind,
        title: "Administration request failed",
        message,
        retryable: false,
      };
  }
}
