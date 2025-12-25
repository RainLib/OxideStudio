/**
 * Utility functions for parsing and building database connection URLs
 */

export interface ParsedConnectionUrl {
  driver: "postgres" | "mysql";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sslMode?: string;
  queryParams?: Record<string, string>;
}

/**
 * Parse a database connection URL into individual components
 * Supports PostgreSQL and MySQL connection strings
 *
 * @param url - Connection URL (e.g., postgres://user:pass@host:5432/db?sslmode=require)
 * @returns Parsed connection parameters
 */
export function parseConnectionUrl(url: string): ParsedConnectionUrl | null {
  if (!url || !url.trim()) {
    return null;
  }

  try {
    // Handle postgres:// and postgresql:// as postgres
    // Handle mysql:// as mysql
    const urlObj = new URL(url.replace("postgresql://", "postgres://"));

    const protocol = urlObj.protocol.replace(":", "");
    if (protocol !== "postgres" && protocol !== "mysql") {
      return null;
    }

    // URL.username and URL.password are automatically decoded
    const user = urlObj.username
      ? decodeURIComponent(urlObj.username)
      : undefined;
    const password = urlObj.password
      ? decodeURIComponent(urlObj.password)
      : undefined;

    // Extract host and port
    const host = urlObj.hostname || undefined;
    const port = urlObj.port ? parseInt(urlObj.port, 10) : undefined;

    // Extract database (remove leading slash)
    const database = urlObj.pathname.slice(1) || undefined;

    // Parse query parameters
    const queryParams: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      queryParams[key] = value;
    });

    const sslMode = queryParams["sslmode"] || queryParams["ssl"];

    return {
      driver: protocol as "postgres" | "mysql",
      host,
      port,
      user,
      password,
      database,
      sslMode,
      queryParams,
    };
  } catch (error) {
    console.error("Failed to parse connection URL:", error);
    return null;
  }
}

/**
 * Build a connection URL from individual components
 * Properly encodes special characters in username and password
 *
 * @param config - Connection configuration
 * @returns Formatted connection URL
 */
export function buildConnectionUrl(config: {
  driver: "postgres" | "mysql";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sslMode?: string;
}): string {
  const {
    driver,
    host = "localhost",
    port,
    user = "",
    password = "",
    database = "",
    sslMode,
  } = config;

  // Determine default port
  const defaultPort = driver === "postgres" ? 5432 : 3306;
  const actualPort = port || defaultPort;

  // Encode username and password to handle special characters
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);

  // Build base URL
  let url = `${driver}://`;

  if (encodedUser || encodedPassword) {
    url += `${encodedUser}:${encodedPassword}@`;
  }

  url += `${host}:${actualPort}`;

  if (database) {
    url += `/${encodeURIComponent(database)}`;
  }

  // Add SSL mode if specified
  if (sslMode && sslMode !== "disable") {
    url += `?sslmode=${sslMode}`;
  }

  return url;
}

/**
 * Validate if a string looks like a valid database connection URL
 */
export function isValidConnectionUrl(url: string): boolean {
  if (!url || !url.trim()) {
    return false;
  }

  const parsed = parseConnectionUrl(url);
  return (
    parsed !== null &&
    (parsed.host !== undefined || parsed.database !== undefined)
  );
}
