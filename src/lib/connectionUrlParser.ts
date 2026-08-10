/**
 * Utility functions for parsing and building database connection URLs
 */

import {
  connectionUrlScheme,
  connectionUrlTemplateForDriver,
  defaultDatabaseCapabilities,
  defaultDatabasePort,
  isFileBasedDatabaseDriver,
  normalizeDatabaseDriverName,
  sslModeParamAliases,
  sslModeParamName,
} from "@/lib/databaseDialect";
import type { DatabaseDriver } from "@/services/tauri/types";

export interface ParsedConnectionUrl {
  driver: DatabaseDriver;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sslMode?: string;
  queryParams?: Record<string, string>;
}

export function stripJdbcPrefix(url: string) {
  return url.toLowerCase().startsWith("jdbc:") ? url.slice(5) : url;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeConnectionUrlForDriver(
  driver: DatabaseDriver,
  connectionUrl: string,
  options: { preserveJdbcPrefix?: boolean } = {},
) {
  const template = connectionUrlTemplateForDriver(driver);
  const preservesJdbcTransport =
    options.preserveJdbcPrefix ||
    template?.toLocaleLowerCase().startsWith("jdbc:") === true;
  let url = preservesJdbcTransport
    ? connectionUrl.trim()
    : stripJdbcPrefix(connectionUrl.trim());
  const profileSslParamName = sslModeParamName(driver);

  for (const alias of sslModeParamAliases(driver)) {
    if (alias === profileSslParamName) continue;
    const pattern = new RegExp(`([?&])${escapeRegExp(alias)}=([^&]+)`, "i");
    const match = url.match(pattern);
    if (!match || !match[1] || !match[2]) continue;

    const separator = match[1];
    const value = match[2].toLowerCase();
    url = url.replace(pattern, `${separator}${profileSslParamName}=${value}`);
    break;
  }

  if (driver === "elasticsearch") {
    const protocol = url.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    const protocolPattern = protocol
      ? new RegExp(`^${escapeRegExp(protocol)}:`, "i")
      : null;
    const httpUrl =
      protocolPattern && protocol && !["http", "https"].includes(protocol)
        ? url.replace(protocolPattern, "http:")
        : url;

    try {
      const urlObject = new URL(httpUrl);
      const sslMode = getQueryParam(
        Object.fromEntries(urlObject.searchParams.entries()),
        sslModeParamAliases(driver),
      )?.toLowerCase();

      if (protocol === "https" || (sslMode && sslMode !== "disable")) {
        urlObject.protocol = "https:";
      } else if (protocol !== "https") {
        urlObject.protocol = "http:";
      }
      const sslAliases = sslModeParamAliases(driver).map((alias) =>
        alias.toLowerCase(),
      );
      for (const key of Array.from(urlObject.searchParams.keys())) {
        if (sslAliases.includes(key.toLowerCase())) {
          urlObject.searchParams.delete(key);
        }
      }
      return urlObject.toString();
    } catch {
      return url;
    }
  }

  return url;
}

/**
 * Carries the optional Elasticsearch index grouping pattern to the bundled
 * driver without ever putting it in a request path. Invalid/manual URLs stay
 * untouched so the connection form remains recoverable while the user edits.
 */
export function applyElasticsearchIndexGroupingPattern(
  connectionUrl: string,
  pattern: string | undefined,
) {
  const normalizedPattern = pattern?.trim() || "";
  try {
    const url = new URL(connectionUrl);
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase() === "indexgroupingpattern") {
        url.searchParams.delete(key);
      }
    }
    if (normalizedPattern) {
      url.searchParams.set("indexGroupingPattern", normalizedPattern);
    }
    return url.toString();
  } catch {
    return connectionUrl;
  }
}

function getQueryParam(
  queryParams: Record<string, string>,
  names: readonly string[],
) {
  for (const name of names) {
    const value = queryParams[name];
    if (value !== undefined) return value;

    const lowerName = name.toLowerCase();
    const matchedKey = Object.keys(queryParams).find(
      (key) => key.toLowerCase() === lowerName,
    );
    if (matchedKey) return queryParams[matchedKey];
  }
  return undefined;
}

/**
 * Parse a database connection URL into individual components
 * Supports PostgreSQL and MySQL connection strings
 *
 * @param url - Connection URL (e.g., postgres://user:pass@host:5432/db?sslmode=require)
 * @returns Parsed connection parameters
 */
export function parseConnectionUrl(
  url: string,
  preferredDriver?: DatabaseDriver,
): ParsedConnectionUrl | null {
  if (!url || !url.trim()) {
    return null;
  }

  try {
    const input = stripJdbcPrefix(url.trim());
    const rawProtocol = input.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || "";
    const isHttpProtocol = ["http", "https"].includes(
      rawProtocol.toLowerCase(),
    );
    // HTTP(S) is a transport, not an Elasticsearch-only dialect. External
    // sidecars such as RQLite keep their driver identity when the user pastes
    // the server's documented HTTP endpoint into that driver's form. With no
    // selected form, preserve the historical Elasticsearch default.
    const driver = isHttpProtocol
      ? preferredDriver ?? "elasticsearch"
      : normalizeDatabaseDriverName(rawProtocol);
    if (!driver) {
      return null;
    }
    if (isFileBasedDatabaseDriver(driver)) {
      const scheme = connectionUrlScheme(driver);
      const schemePattern = new RegExp(`^${escapeRegExp(scheme)}:`, "i");
      let database = input.replace(schemePattern, "");
      if (database === ":memory:") {
        return { driver, database };
      }
      // `duckdb:///tmp/data.duckdb` and `sqlite:///tmp/data.sqlite` retain
      // their leading slash. The generic URL parser intentionally drops it
      // when mapping pathname to a database name, which would turn an
      // absolute local path into a relative one when the form is reopened.
      if (database.startsWith("//")) database = database.slice(2);
      return {
        driver,
        database: database ? decodeURIComponent(database) : undefined,
      };
    }
    const protocolPattern = new RegExp(`^${escapeRegExp(rawProtocol)}:`, "i");
    const urlObj = new URL(
      isHttpProtocol
        ? input
        : input.replace(protocolPattern, `${connectionUrlScheme(driver)}:`),
    );

    // WHATWG URL preserves percent escapes in user info, so decode exactly
    // once before displaying the values or rebuilding the connection URL.
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

    const configuredSslMode = getQueryParam(
      queryParams,
      sslModeParamAliases(driver),
    );
    const sslMode =
      driver === "elasticsearch"
        ? configuredSslMode ||
          (urlObj.protocol.toLowerCase() === "https:" ? "require" : "disable")
        : configuredSslMode;

    return {
      driver,
      host,
      port,
      user,
      password,
      database,
      sslMode,
      queryParams,
    };
  } catch {
    // Connection URLs can contain credentials. Never echo parser errors that
    // may embed the original URL into renderer logs.
    console.error("Failed to parse connection URL");
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
  driver: DatabaseDriver;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  sslMode?: string;
  /** A signed external-package template overrides the generic URL renderer. */
  connectionUrlTemplate?: string | null;
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

  const template =
    config.connectionUrlTemplate?.trim() || connectionUrlTemplateForDriver(driver);
  if (template) {
    return template.replace(
      /\{(host|port|database|user|password)\}/gu,
      (_match, key: "host" | "port" | "database" | "user" | "password") => {
        if (key === "host") return host;
        if (key === "port") return String(port || defaultDatabasePort(driver));
        // A signed package author owns this grammar. JDBC database paths such
        // as `hive/default` and Oracle service names must not be normalized as
        // one generic URL path component.
        if (key === "database") return database;
        if (key === "user") return user;
        return password;
      },
    );
  }

  // File-backed engines deliberately do not inherit the network URL builder:
  // `sqlite://localhost/path` would silently create a file named `path` and
  // make the connection form look like it needs a server.
  if (isFileBasedDatabaseDriver(driver)) {
    const scheme = connectionUrlScheme(driver);
    const file = (database || host || ":memory:").trim();
    if (file === ":memory:" || file === `${scheme}::memory:`) {
      return `${scheme}::memory:`;
    }
    if (file.toLowerCase().startsWith(`${scheme.toLowerCase()}:`)) return file;
    return file.startsWith("/") ? `${scheme}://${file}` : `${scheme}:///${file}`;
  }

  const actualPort = port || defaultDatabasePort(driver);

  // Encode username and password to handle special characters
  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);

  // Build base URL
  const secureElasticsearch =
    driver === "elasticsearch" && sslMode && sslMode !== "disable";
  const scheme = secureElasticsearch ? "https" : connectionUrlScheme(driver);
  let url = `${scheme}://`;

  if (encodedUser || encodedPassword) {
    url += `${encodedUser}:${encodedPassword}@`;
  }

  url += host;
  if (actualPort) {
    url += `:${actualPort}`;
  }

  if (
    database &&
    defaultDatabaseCapabilities(driver).supportsConnectionDatabase !== false
  ) {
    url += `/${encodeURIComponent(database)}`;
  }

  // Add SSL mode if specified
  if (driver !== "elasticsearch" && sslMode && sslMode !== "disable") {
    url += `?${sslModeParamName(driver)}=${sslMode.toLowerCase()}`;
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
