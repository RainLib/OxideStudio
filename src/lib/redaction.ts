const SECRET_KEY_PATTERN = /password|passwd|pwd|pass|secret|token/i;
const CONNECTION_STRING_KEY_PATTERN = /url|connectionUrl|dataSourceName/i;

export function redactSecretString(value: string): string {
  return value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/[^:/?#@\s]+):([^@/?#\s]*)@/gi,
      "$1:****@"
    )
    .replace(/^([^:@/?#\s]+):([^@\s]*)@tcp\(/i, "$1:****@tcp(")
    .replace(/([?&](?:password|passwd|pwd|pass)=)[^&#]*/gi, "$1****");
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecretString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      redacted[key] = typeof entry === "string" && entry ? "****" : entry;
    } else if (
      CONNECTION_STRING_KEY_PATTERN.test(key) &&
      typeof entry === "string"
    ) {
      redacted[key] = redactSecretString(entry);
    } else {
      redacted[key] = redactSecrets(entry);
    }
  }

  return redacted as T;
}
