const CONNECTION_SESSION_PATTERN =
  /(?:connection (?:session )?not found|connection session is not active)/i;

export interface QueryErrorPresentation {
  title: string;
  description: string;
  suggestion: string | null;
  technicalDetails: string | null;
  retryable: boolean;
  metadata: Array<{ label: string; value: string }>;
}

export type DatabaseQueryErrorKind =
  | "uniqueViolation"
  | "foreignKeyViolation"
  | "notNullViolation"
  | "checkViolation";

export interface DatabaseQueryErrorDetail {
  driver: "postgres" | "mysql" | "database";
  sqlState?: string;
  vendorCode?: number;
  severity?: string;
  position?: number;
  executionLine?: number;
  executionColumn?: number;
  documentOffset?: number;
  documentLine?: number;
  documentColumn?: number;
  documentExecutionRange?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  schema?: string;
  table?: string;
  column?: string;
  constraint?: string;
  dataType?: string;
  kind?: DatabaseQueryErrorKind;
}

export interface QueryExecutionErrorDetail {
  code: string;
  message: string;
  retryable: boolean;
  database?: DatabaseQueryErrorDetail;
}

function sentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function safeInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : undefined;
}

function utf16OffsetForDatabasePosition(sql: string, position: number) {
  const targetCharacters = Math.max(0, position - 1);
  let characters = 0;
  let utf16Offset = 0;
  for (const character of sql) {
    if (characters >= targetCharacters) break;
    characters += 1;
    utf16Offset += character.length;
  }
  return Math.min(utf16Offset, sql.length);
}

function lineAndColumnAtUtf16Offset(text: string, offset: number) {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(0, boundedOffset);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
  };
}

export function extractQueryExecutionError(
  error: unknown,
  executedSql: string,
  documentSql: string,
  sourceStartOffset?: number,
): QueryExecutionErrorDetail {
  const value = isRecord(error) ? error : null;
  const context = value && isRecord(value.context) ? value.context : null;
  const rawDatabaseError =
    context && isRecord(context.databaseError)
      ? context.databaseError
      : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof value?.message === "string"
        ? value.message
        : String(error || "The query did not complete.");
  const code =
    typeof value?.code === "string" && value.code.trim()
      ? value.code
      : "QUERY_EXECUTION_FAILED";
  const retryable =
    typeof value?.retryable === "boolean" ? value.retryable : false;

  if (!rawDatabaseError) {
    return { code, message, retryable };
  }

  const driver =
    rawDatabaseError.driver === "postgres" ||
    rawDatabaseError.driver === "mysql" ||
    rawDatabaseError.driver === "database"
      ? rawDatabaseError.driver
      : null;
  if (!driver) return { code, message, retryable };

  const sqlState =
    typeof rawDatabaseError.sqlState === "string" &&
    /^[0-9A-Z]{5}$/i.test(rawDatabaseError.sqlState)
      ? rawDatabaseError.sqlState.toUpperCase()
      : undefined;
  const vendorCode = safeInteger(rawDatabaseError.vendorCode, 0, 65_535);
  const position = safeInteger(rawDatabaseError.position, 1, 100_000_000);
  const severity =
    typeof rawDatabaseError.severity === "string" &&
    /^(?:PANIC|FATAL|ERROR|WARNING|NOTICE|DEBUG|INFO|LOG)$/.test(
      rawDatabaseError.severity,
    )
      ? rawDatabaseError.severity
      : undefined;
  const kind =
    rawDatabaseError.kind === "uniqueViolation" ||
    rawDatabaseError.kind === "foreignKeyViolation" ||
    rawDatabaseError.kind === "notNullViolation" ||
    rawDatabaseError.kind === "checkViolation"
      ? rawDatabaseError.kind
      : undefined;
  const relativeOffset = position
    ? utf16OffsetForDatabasePosition(executedSql, position)
    : undefined;
  const executionLocation =
    relativeOffset === undefined
      ? null
      : lineAndColumnAtUtf16Offset(executedSql, relativeOffset);
  const validSourceStart =
    sourceStartOffset !== undefined &&
    Number.isSafeInteger(sourceStartOffset) &&
    sourceStartOffset >= 0 &&
    sourceStartOffset <= documentSql.length
      ? sourceStartOffset
      : undefined;
  const documentOffset =
    relativeOffset !== undefined && validSourceStart !== undefined
      ? Math.min(documentSql.length, validSourceStart + relativeOffset)
      : undefined;
  const documentLocation =
    documentOffset === undefined
      ? null
      : lineAndColumnAtUtf16Offset(documentSql, documentOffset);
  const executionDocumentStart =
    validSourceStart === undefined
      ? null
      : lineAndColumnAtUtf16Offset(documentSql, validSourceStart);
  const executionDocumentEnd =
    validSourceStart === undefined
      ? null
      : lineAndColumnAtUtf16Offset(
          documentSql,
          Math.min(documentSql.length, validSourceStart + executedSql.length),
        );

  return {
    code,
    message,
    retryable,
    database: {
      driver,
      sqlState,
      vendorCode,
      severity,
      position,
      executionLine: executionLocation?.line,
      executionColumn: executionLocation?.column,
      documentOffset,
      documentLine: documentLocation?.line,
      documentColumn: documentLocation?.column,
      documentExecutionRange:
        executionDocumentStart && executionDocumentEnd
          ? {
              startLine: executionDocumentStart.line,
              startColumn: executionDocumentStart.column,
              endLine: executionDocumentEnd.line,
              endColumn: executionDocumentEnd.column,
            }
          : undefined,
      schema: safeIdentifier(rawDatabaseError.schema),
      table: safeIdentifier(rawDatabaseError.table),
      column: safeIdentifier(rawDatabaseError.column),
      constraint: safeIdentifier(rawDatabaseError.constraint),
      dataType: safeIdentifier(rawDatabaseError.dataType),
      kind,
    },
  };
}

function databaseErrorSuggestion(kind?: DatabaseQueryErrorKind) {
  if (kind === "uniqueViolation") {
    return "Change the conflicting key value or update the existing row, then run the statement again.";
  }
  if (kind === "foreignKeyViolation") {
    return "Check the referenced row and the operation order before running the statement again.";
  }
  if (kind === "notNullViolation") {
    return "Provide a value for the required column or change its default before retrying.";
  }
  if (kind === "checkViolation") {
    return "Adjust the row so it satisfies the reported check constraint before retrying.";
  }
  return null;
}

export function isMissingConnectionSession(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    code === "CONNECTION_SESSION_NOT_FOUND" ||
    CONNECTION_SESSION_PATTERN.test(message)
  );
}

export function presentQueryError(
  error: string,
  connectionName?: string | null,
  detail?: QueryExecutionErrorDetail | null,
): QueryErrorPresentation {
  const message = error.trim() || "The query did not complete.";
  const displayName = connectionName?.trim() || "the selected data source";
  const databaseError = detail?.database;
  const metadata: QueryErrorPresentation["metadata"] = [];
  if (databaseError?.sqlState) {
    metadata.push({ label: "SQLSTATE", value: databaseError.sqlState });
  }
  if (databaseError?.vendorCode !== undefined) {
    metadata.push({
      label: databaseError.driver === "mysql" ? "MySQL" : "Code",
      value: String(databaseError.vendorCode),
    });
  }
  if (
    databaseError?.documentLine !== undefined &&
    databaseError.documentColumn !== undefined
  ) {
    metadata.push({
      label: "Location",
      value: `Ln ${databaseError.documentLine}, Col ${databaseError.documentColumn}`,
    });
  } else if (
    databaseError?.executionLine !== undefined &&
    databaseError.executionColumn !== undefined
  ) {
    metadata.push({
      label: "Statement",
      value: `Ln ${databaseError.executionLine}, Col ${databaseError.executionColumn}`,
    });
  }
  for (const [label, value] of [
    ["Table", databaseError?.table],
    ["Column", databaseError?.column],
    ["Constraint", databaseError?.constraint],
  ] as const) {
    if (value) metadata.push({ label, value });
  }

  if (CONNECTION_SESSION_PATTERN.test(message)) {
    return {
      title: "Data source session expired",
      description: `The saved connection to “${displayName}” still exists, but its live session was closed or was not restored after the workspace changed.`,
      suggestion:
        "Run the query again. OxideStudio will reconnect automatically. If it still fails, test the data source in Connection Settings.",
      technicalDetails: message,
      retryable: true,
      metadata,
    };
  }

  if (/could not (?:restore|connect|reconnect)/i.test(message)) {
    return {
      title: "Could not reconnect to the data source",
      description: sentence(message),
      suggestion:
        "Check the host, credentials, network, and Elasticsearch version in Connection Settings, then try again.",
      technicalDetails: null,
      retryable: true,
      metadata,
    };
  }

  if (/\b(?:401|unauthorized|authentication|invalid credentials)\b/i.test(message)) {
    return {
      title: "Authentication failed",
      description: sentence(message),
      suggestion:
        "Verify the username, password, or API key in Connection Settings, then test the connection again.",
      technicalDetails: null,
      retryable: true,
      metadata,
    };
  }

  if (/\b(?:timed? out|timeout)\b/i.test(message)) {
    return {
      title: "The data source did not respond in time",
      description: sentence(message),
      suggestion: "Check the network or server load, then run the query again.",
      technicalDetails: null,
      retryable: true,
      metadata,
    };
  }

  return {
    title: "Query failed",
    description: sentence(message),
    suggestion: databaseErrorSuggestion(databaseError?.kind),
    technicalDetails: null,
    retryable: detail?.retryable ?? true,
    metadata,
  };
}
