import type { DatabaseDriver } from "@/services/tauri/types";

export type ConnectionImportSource = "datagrip" | "dbeaver" | "navicat";

export type ConnectionImportCandidate = {
  id: string;
  source: ConnectionImportSource;
  name: string;
  driver: DatabaseDriver | null;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** Never contains a password or other secret URL parameters. */
  connectionUrl?: string;
  warnings: string[];
};

export type ConnectionImportParseResult = {
  candidates: ConnectionImportCandidate[];
  diagnostics: string[];
};

/** Detect DBX export envelopes before falling back to the selected file type. */
export function detectConnectionImportSource(
  fileName: string,
  content: string,
): ConnectionImportSource {
  try {
    const payload = JSON.parse(content) as { format?: unknown };
    if (payload.format === "datagrip-import") return "datagrip";
    if (payload.format === "dbeaver-import") return "dbeaver";
    if (payload.format === "navicat-import") return "navicat";
  } catch {
    // Raw XML and JSON files intentionally use the filename fallback below.
  }
  const normalizedFileName = fileName.toLocaleLowerCase();
  if (normalizedFileName.endsWith(".ncx")) return "navicat";
  if (/\b(?:ConnName|ConnType|UserName)=/iu.test(content) && /<Connections?\b/iu.test(content)) {
    return "navicat";
  }
  return normalizedFileName.endsWith(".xml") ? "datagrip" : "dbeaver";
}

const DRIVER_ALIASES: Record<string, DatabaseDriver> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  duckdb: "duckdb",
  mongodb: "mongodb",
  mongo: "mongodb",
  redis: "redis",
  elasticsearch: "elasticsearch",
  easysearch: "easysearch",
  clickhouse: "clickhouse",
  sqlserver: "sqlserver",
  mssql: "sqlserver",
  oracle: "oracle",
  trino: "trino",
  prestosql: "prestosql",
  presto: "prestosql",
  snowflake: "snowflake",
  redshift: "redshift",
  bigquery: "bigquery",
  hive: "hive",
  db2: "db2",
  firebird: "firebird",
  h2: "h2",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDriver(value: string): DatabaseDriver | null {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (DRIVER_ALIASES[normalized]) return DRIVER_ALIASES[normalized]!;
  return Object.entries(DRIVER_ALIASES).find(([needle]) =>
    normalized.includes(needle),
  )?.[1] || null;
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 65_535
    ? parsed
    : undefined;
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function xmlAttribute(source: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`\\b${escaped}=(?:\"([^\"]*)\"|'([^']*)')`, "iu"));
  return decodeXml(match?.[1] || match?.[2] || "").trim();
}

/** Strip URL user info and the most common password query/property spellings. */
export function sanitizeImportedConnectionUrl(value: string) {
  return value
    .trim()
    // Oracle Thin permits `jdbc:oracle:thin:user/password@host`. Keeping the
    // username is not worth risking that this compact legacy form leaks the
    // password into a saved URL; a separate user field remains available.
    .replace(/(jdbc:oracle:thin:)(?:[^@/\s]+\/[^@\s]+@)/iu, "$1@")
    .replace(/(\/\/)(?:[^/@\s]*@)/u, "$1")
    .replace(/([?;&](?:password|pwd|pass)=)[^?;&#\s]*/giu, "$1")
    .replace(/([?&](?:access[_-]?token|token|secret)=)[^?&#\s]*/giu, "$1");
}

type Endpoint = Pick<
  ConnectionImportCandidate,
  "host" | "port" | "database" | "user" | "connectionUrl"
>;

function parseConnectionUrl(rawUrl: string): Endpoint {
  const connectionUrl = sanitizeImportedConnectionUrl(rawUrl);
  if (!connectionUrl) return {};
  const jdbc = connectionUrl.replace(/^jdbc:/iu, "");
  const sqlServer = jdbc.match(/^sqlserver:\/\/([^;:/]+)(?::(\d+))?(?:;(.*))?$/iu);
  if (sqlServer) {
    const properties = Object.fromEntries(
      (sqlServer[3] || "")
        .split(";")
        .map((entry) => entry.split(/=(.*)/su))
        .filter(([key]) => Boolean(key))
        .map(([key, value]) => [key!.toLowerCase(), value || ""]),
    );
    return {
      connectionUrl,
      host: sqlServer[1],
      port: number(sqlServer[2]),
      database: text(properties.databasename || properties.database),
      user: text(properties.user || properties.username),
    };
  }
  const oracleService = jdbc.match(/^oracle:thin:@\/\/([^:/]+)(?::(\d+))?\/([^?;]+)/iu);
  if (oracleService) {
    return {
      connectionUrl,
      host: oracleService[1],
      port: number(oracleService[2]),
      database: oracleService[3],
    };
  }
  const oracleSid = jdbc.match(/^oracle:thin:@([^:/]+)(?::(\d+))?:([^?;]+)/iu);
  if (oracleSid) {
    return {
      connectionUrl,
      host: oracleSid[1],
      port: number(oracleSid[2]),
      database: oracleSid[3],
    };
  }
  const file = jdbc.match(/^(?:sqlite|duckdb):(.+)$/iu);
  if (file) return { connectionUrl, host: file[1]?.split(/[?#]/u)[0] };

  const authorityStart = jdbc.indexOf("://");
  if (authorityStart < 0) return { connectionUrl };
  const rest = jdbc.slice(authorityStart + 3);
  const [authorityAndPath = "", query = ""] = rest.split("?", 2);
  const slash = authorityAndPath.indexOf("/");
  const authority = slash < 0 ? authorityAndPath : authorityAndPath.slice(0, slash);
  const database = slash < 0 ? "" : authorityAndPath.slice(slash + 1).split("/", 1)[0];
  const at = authority.lastIndexOf("@");
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const user = at >= 0 ? authority.slice(0, at).split(":", 1)[0] : "";
  const ipv6 = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/u);
  const hostPortMatch = ipv6 || hostPort.match(/^([^:]+?)(?::(\d+))?$/u);
  const queryParams = new URLSearchParams(query);
  return {
    connectionUrl,
    host: hostPortMatch?.[1],
    port: number(hostPortMatch?.[2]),
    database: decodeURIComponent(database || queryParams.get("database") || "") || undefined,
    user: decodeURIComponent(user || queryParams.get("user") || "") || undefined,
  };
}

function candidate(
  input: Omit<ConnectionImportCandidate, "warnings">,
  sensitiveUrlWasRedacted = false,
): ConnectionImportCandidate {
  const warnings: string[] = [];
  if (!input.driver) warnings.push("No supported OxideStudio driver could be identified.");
  if (sensitiveUrlWasRedacted) {
    warnings.push("Sensitive URL parameters were removed.");
  }
  return { ...input, warnings };
}

function containsSensitiveUrlMaterial(rawUrl: string) {
  return /(?:\/\/[^/@\s]*@|oracle:thin:[^@/\s]+\/[^@\s]+@|(?:password|pwd|pass|access[_-]?token|token|secret)=)/iu.test(
    rawUrl,
  );
}

function parseDbeaver(content: string): ConnectionImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { candidates: [], diagnostics: ["DBeaver file is not valid JSON."] };
  }
  const envelope = parsed as Record<string, unknown>;
  const nestedDataSources =
    envelope.format === "dbeaver-import" && typeof envelope.dataSources === "string"
      ? envelope.dataSources
      : null;
  if (nestedDataSources) {
    try {
      parsed = JSON.parse(nestedDataSources);
    } catch {
      return { candidates: [], diagnostics: ["DBeaver export contains invalid data source JSON."] };
    }
  }
  const root = parsed as Record<string, unknown>;
  const source = root.connections || root.dataSources || root.datasources || root;
  const entries = Array.isArray(source)
    ? source.map((entry, index) => [String(index), entry] as const)
    : source && typeof source === "object"
      ? Object.entries(source as Record<string, unknown>)
      : [];
  const candidates = entries.flatMap(([id, entry]) => {
    if (!entry || typeof entry !== "object") return [];
    const value = entry as Record<string, unknown>;
    const configuration = (value.configuration || {}) as Record<string, unknown>;
    const rawUrl = text(configuration.url);
    const rawDriver = [value.driver, value.provider, rawUrl, value.name]
      .map(text)
      .join(" ");
    const endpoint = parseConnectionUrl(rawUrl);
    return [candidate({
      id: `dbeaver:${text(value.id) || id}`,
      source: "dbeaver",
      name: text(value.name) || endpoint.database || endpoint.host || "Imported DBeaver connection",
      driver: normalizeDriver(rawDriver),
      host: text(configuration.host || configuration["host-name"] || endpoint.host) || undefined,
      port: number(configuration.port || configuration["host-port"] || endpoint.port),
      database: text(configuration.database || configuration["database-name"] || endpoint.database) || undefined,
      user: text(configuration.user || configuration.username || endpoint.user) || undefined,
      connectionUrl: endpoint.connectionUrl,
    }, containsSensitiveUrlMaterial(rawUrl))];
  });
  return { candidates, diagnostics: candidates.length ? [] : ["No DBeaver connections were found."] };
}

function parseDataGrip(content: string): ConnectionImportParseResult {
  let xml = content;
  try {
    const envelope = JSON.parse(content) as Record<string, unknown>;
    if (envelope.format === "datagrip-import") {
      if (typeof envelope.dataSources !== "string") {
        return { candidates: [], diagnostics: ["DataGrip export does not contain dataSources XML."] };
      }
      xml = envelope.dataSources;
    }
  } catch {
    // Raw DataGrip XML is expected for normal imports.
  }
  const candidates: ConnectionImportCandidate[] = [];
  const blocks = xml.matchAll(/<data-source\b([^>]*)>([\s\S]*?)<\/data-source>/giu);
  for (const [index, match] of Array.from(blocks).entries()) {
    const attributes = match[1] || "";
    const body = match[2] || "";
    const option = (name: string) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const expression = new RegExp(`<option\\b(?=[^>]*\\bname=(?:\"${escaped}\"|'${escaped}'))[^>]*\\bvalue=(?:\"([^\"]*)\"|'([^']*)')[^>]*\\/?\\s*>`, "iu");
      const value = body.match(expression);
      return decodeXml(value?.[1] || value?.[2] || "").trim();
    };
    const elementText = (name: string) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const value = body.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "iu"));
      return decodeXml(value?.[1] || "").trim();
    };
    const rawUrl =
      option("url") ||
      option("jdbc-url") ||
      elementText("jdbc-url") ||
      elementText("url");
    const endpoint = parseConnectionUrl(rawUrl);
    const databaseProduct = body.match(/<database-info\b[^>]*\bproduct=(?:"([^"]*)"|'([^']*)')[^>]*\/?\s*>/iu);
    const rawDriver = [
      xmlAttribute(attributes, "driver-ref"),
      elementText("driver-ref"),
      decodeXml(databaseProduct?.[1] || databaseProduct?.[2] || ""),
      xmlAttribute(attributes, "name"),
      rawUrl,
    ].join(" ");
    candidates.push(candidate({
      id: `datagrip:${xmlAttribute(attributes, "uuid") || index}`,
      source: "datagrip",
      name: xmlAttribute(attributes, "name") || endpoint.database || endpoint.host || "Imported DataGrip connection",
      driver: normalizeDriver(rawDriver),
      host: endpoint.host,
      port: endpoint.port,
      database: endpoint.database,
      user:
        option("user") ||
        option("username") ||
        elementText("user-name") ||
        endpoint.user,
      connectionUrl: endpoint.connectionUrl,
    }, containsSensitiveUrlMaterial(rawUrl)));
  }
  return { candidates, diagnostics: candidates.length ? [] : ["No DataGrip data sources were found."] };
}

/**
 * Navicat's older export format is XML/NCX. Passwords in those files are
 * encrypted or opaque product fields, so this parser never reads them; it
 * only imports the non-secret endpoint attributes required to recreate a
 * connection manually.
 */
function parseNavicat(content: string): ConnectionImportParseResult {
  const candidates: ConnectionImportCandidate[] = [];
  const blocks = content.matchAll(/<Connection\b([^>]*)\/?\s*>/giu);
  for (const [index, match] of Array.from(blocks).entries()) {
    const attributes = match[1] || "";
    const rawUrl =
      xmlAttribute(attributes, "ConnectionUrl") ||
      xmlAttribute(attributes, "Url") ||
      xmlAttribute(attributes, "URI");
    const endpoint = parseConnectionUrl(rawUrl);
    const product =
      xmlAttribute(attributes, "ConnType") ||
      xmlAttribute(attributes, "Driver") ||
      xmlAttribute(attributes, "DbType");
    const imported = candidate({
      id: `navicat:${xmlAttribute(attributes, "Id") || xmlAttribute(attributes, "UUID") || index}`,
      source: "navicat",
      name:
        xmlAttribute(attributes, "ConnName") ||
        xmlAttribute(attributes, "Name") ||
        endpoint.database ||
        endpoint.host ||
        "Imported Navicat connection",
      driver: normalizeDriver([product, rawUrl].join(" ")),
      host: xmlAttribute(attributes, "Host") || endpoint.host || undefined,
      port: number(xmlAttribute(attributes, "Port") || endpoint.port),
      database:
        xmlAttribute(attributes, "Database") ||
        xmlAttribute(attributes, "DatabaseName") ||
        endpoint.database ||
        undefined,
      user:
        xmlAttribute(attributes, "UserName") ||
        xmlAttribute(attributes, "User") ||
        endpoint.user ||
        undefined,
      connectionUrl: endpoint.connectionUrl,
    }, containsSensitiveUrlMaterial(rawUrl));
    if (xmlAttribute(attributes, "Password")) {
      imported.warnings.push("Navicat password data was not imported.");
    }
    if (xmlAttribute(attributes, "Folder") || xmlAttribute(attributes, "Group")) {
      imported.warnings.push("Navicat folder/group placement was not imported.");
    }
    candidates.push(imported);
  }
  return { candidates, diagnostics: candidates.length ? [] : ["No Navicat connections were found."] };
}

export function parseConnectionImport(
  source: ConnectionImportSource,
  content: string,
): ConnectionImportParseResult {
  if (source === "dbeaver") return parseDbeaver(content);
  if (source === "navicat") return parseNavicat(content);
  return parseDataGrip(content);
}
