const CONNECTION_SESSION_PATTERN =
  /(?:connection (?:session )?not found|connection session is not active)/i;

export interface QueryErrorPresentation {
  title: string;
  description: string;
  suggestion: string | null;
  technicalDetails: string | null;
  retryable: boolean;
}

function sentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
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
): QueryErrorPresentation {
  const message = error.trim() || "The query did not complete.";
  const displayName = connectionName?.trim() || "the selected data source";

  if (CONNECTION_SESSION_PATTERN.test(message)) {
    return {
      title: "Data source session expired",
      description: `The saved connection to “${displayName}” still exists, but its live session was closed or was not restored after the workspace changed.`,
      suggestion:
        "Run the query again. OxideStudio will reconnect automatically. If it still fails, test the data source in Connection Settings.",
      technicalDetails: message,
      retryable: true,
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
    };
  }

  if (/\b(?:timed? out|timeout)\b/i.test(message)) {
    return {
      title: "The data source did not respond in time",
      description: sentence(message),
      suggestion: "Check the network or server load, then run the query again.",
      technicalDetails: null,
      retryable: true,
    };
  }

  return {
    title: "Query failed",
    description: sentence(message),
    suggestion: null,
    technicalDetails: null,
    retryable: true,
  };
}
