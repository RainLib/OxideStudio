import type { DatabaseDriver } from "@/services/tauri/types";

export type AiQuerySafety = "read" | "write" | "destructive";

export function classifyAiQuerySafety(
  query: string,
  driver?: DatabaseDriver | null
): AiQuerySafety {
  if (looksAiQueryReadOnly(query, driver)) return "read";
  if (looksAiQueryDestructive(query, driver)) return "destructive";
  return "write";
}

export function looksAiQueryReadOnly(
  query: string,
  driver?: DatabaseDriver | null
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const normalizedDriver = String(driver || "").trim().toLowerCase();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    if (normalizedDriver === "mongodb" || normalizedDriver === "mongo") {
      return looksReadOnlyMongoCommand(query);
    }
    return looksReadOnlyJsonSearchBody(query);
  }

  if (normalizedDriver === "redis") {
    return looksReadOnlyRedisCommands(query);
  }

  if (normalizedDriver === "elasticsearch" || normalizedDriver === "elastic") {
    return looksReadOnlyElasticsearchRequest(query);
  }

  const mutatingSqlPrefixes = [
    "alter",
    "call",
    "comment",
    "copy",
    "create",
    "delete",
    "drop",
    "grant",
    "insert",
    "load",
    "merge",
    "replace",
    "revoke",
    "set",
    "truncate",
    "update",
    "vacuum",
  ];

  return !mutatingSqlPrefixes.some((prefix) => normalized.startsWith(prefix));
}

export function looksAiQueryDestructive(
  query: string,
  driver?: DatabaseDriver | null
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;

  const normalizedDriver = String(driver || "").trim().toLowerCase();
  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    if (normalizedDriver === "mongodb" || normalizedDriver === "mongo") {
      return looksDestructiveMongoCommand(query);
    }
    return looksDestructiveJsonSearchBody(query);
  }

  if (normalizedDriver === "redis") {
    return looksDestructiveRedisCommands(query);
  }

  if (normalizedDriver === "elasticsearch" || normalizedDriver === "elastic") {
    return looksDestructiveElasticsearchRequest(query);
  }

  return ["delete", "drop", "truncate"].some((prefix) =>
    normalized.startsWith(prefix)
  );
}

function looksReadOnlyJsonSearchBody(query: string) {
  const normalized = query.toLowerCase();
  const mutatingMarkers = [
    '"delete"',
    '"delete_by_query"',
    '"doc"',
    '"index"',
    '"scripted_upsert"',
    '"update"',
    '"upsert"',
  ];
  return !mutatingMarkers.some((marker) => normalized.includes(marker));
}

function looksDestructiveJsonSearchBody(query: string) {
  const normalized = query.toLowerCase();
  return normalized.includes('"delete"') || normalized.includes('"delete_by_query"');
}

function looksReadOnlyMongoCommand(query: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return false;
  }

  const commands = Array.isArray(parsed) ? parsed : [parsed];
  return commands.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const payload = item as Record<string, unknown>;
    const keys = Object.keys(payload).map((key) => key.toLowerCase());
    const operations = keys.filter((key) =>
      [
        "aggregate",
        "command",
        "countdocuments",
        "deletemany",
        "deleteone",
        "find",
        "insertmany",
        "insertone",
        "updatemany",
        "updateone",
      ].includes(key)
    );

    if (operations.length === 0) {
      return typeof payload.collection === "string";
    }
    if (operations.length > 1) return false;

    const operation = operations[0];
    if (!operation) return false;
    if (["find", "aggregate", "countdocuments"].includes(operation)) {
      return true;
    }
    if (operation !== "command") return false;

    const commandBody = payload.command;
    if (!commandBody || typeof commandBody !== "object" || Array.isArray(commandBody)) {
      return false;
    }
    const [commandName] = Object.keys(commandBody);
    return Boolean(commandName && READ_ONLY_MONGO_COMMANDS.has(commandName.toLowerCase()));
  });
}

function looksDestructiveMongoCommand(query: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return false;
  }

  const commands = Array.isArray(parsed) ? parsed : [parsed];
  return commands.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const payload = item as Record<string, unknown>;
    const keys = Object.keys(payload).map((key) => key.toLowerCase());
    if (
      keys.some((key) =>
        [
          "collmod",
          "deleteone",
          "deletemany",
          "drop",
          "dropdatabase",
          "renamecollection",
        ].includes(key)
      )
    ) {
      return true;
    }

    const commandBody = payload.command;
    if (!commandBody || typeof commandBody !== "object" || Array.isArray(commandBody)) {
      return false;
    }
    const [commandName] = Object.keys(commandBody).map((key) => key.toLowerCase());
    return Boolean(
      commandName &&
        [
          "collmod",
          "delete",
          "drop",
          "dropdatabase",
          "dropindexes",
          "findandmodify",
          "renamecollection",
        ].includes(commandName)
    );
  });
}

const READ_ONLY_MONGO_COMMANDS = new Set([
  "aggregate",
  "buildinfo",
  "collstats",
  "count",
  "dbstats",
  "distinct",
  "explain",
  "find",
  "hello",
  "ismaster",
  "listcollections",
  "listdatabases",
  "listindexes",
  "ping",
  "serverstatus",
]);

function looksReadOnlyElasticsearchRequest(query: string) {
  const requestLines = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (requestLines.length === 0) return false;

  const parsedRequests = requestLines
    .map((line) => line.match(/^(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\S+)/i))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  if (parsedRequests.length === 0) return false;

  return parsedRequests.every((match) => {
    const method = match[1]!.toUpperCase();
    const path = match[2]!.toLowerCase();
    if (method === "GET" || method === "HEAD") return true;
    if (method !== "POST") return false;
    return READ_ONLY_ELASTICSEARCH_POST_PATHS.some((pattern) => pattern.test(path));
  });
}

function looksDestructiveElasticsearchRequest(query: string) {
  const requestLines = query
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  return requestLines.some((line) => {
    const match = line.match(/^(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
    if (!match) return false;

    const method = match[1]!.toUpperCase();
    const path = match[2]!.toLowerCase();
    return (
      method === "DELETE" ||
      path.includes("_delete_by_query") ||
      path.includes("_close") ||
      path.includes("_forcemerge") ||
      path.includes("_shrink") ||
      path.includes("_split")
    );
  });
}

const READ_ONLY_ELASTICSEARCH_POST_PATHS = [
  /^\/_search(?:[/?#]|$)/,
  /^\/_msearch(?:[/?#]|$)/,
  /^\/_count(?:[/?#]|$)/,
  /^\/_sql(?:[/?#]|$)/,
  /^\/_eql\/search(?:[/?#]|$)/,
  /^\/_async_search(?:[/?#]|$)/,
  /^\/[^/]+\/_search(?:[/?#]|$)/,
  /^\/[^/]+\/_msearch(?:[/?#]|$)/,
  /^\/[^/]+\/_count(?:[/?#]|$)/,
];

function looksReadOnlyRedisCommands(query: string) {
  const commands = parseRedisCommandLines(query);
  if (commands.length === 0) return false;

  return commands.every((line) => {
    const command = line.split(/\s+/)[0]?.toUpperCase();
    return Boolean(command && READ_ONLY_REDIS_COMMANDS.has(command));
  });
}

function looksDestructiveRedisCommands(query: string) {
  return parseRedisCommandLines(query).some((line) => {
    const command = line.split(/\s+/)[0]?.toUpperCase();
    return Boolean(command && DESTRUCTIVE_REDIS_COMMANDS.has(command));
  });
}

function parseRedisCommandLines(query: string) {
  return query
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/;$/, ""))
    .filter((line) => line && !line.startsWith("#"));
}

const READ_ONLY_REDIS_COMMANDS = new Set([
  "DBSIZE",
  "EXISTS",
  "FT.INFO",
  "FT.SEARCH",
  "GET",
  "GETRANGE",
  "HGET",
  "HGETALL",
  "HEXISTS",
  "HKEYS",
  "HLEN",
  "HMGET",
  "HSCAN",
  "HSTRLEN",
  "HVALS",
  "JSON.GET",
  "JSON.MGET",
  "KEYS",
  "LINDEX",
  "LLEN",
  "LRANGE",
  "MGET",
  "PING",
  "PTTL",
  "SCAN",
  "SCARD",
  "SISMEMBER",
  "SMEMBERS",
  "SRANDMEMBER",
  "SSCAN",
  "STRLEN",
  "TTL",
  "TYPE",
  "XINFO",
  "XLEN",
  "XRANGE",
  "XREAD",
  "XREVRANGE",
  "ZCARD",
  "ZCOUNT",
  "ZLEXCOUNT",
  "ZRANGE",
  "ZRANGEBYLEX",
  "ZRANGEBYSCORE",
  "ZRANK",
  "ZREVRANGE",
  "ZREVRANGEBYLEX",
  "ZREVRANGEBYSCORE",
  "ZREVRANK",
  "ZSCAN",
  "ZSCORE",
]);

const DESTRUCTIVE_REDIS_COMMANDS = new Set([
  "DEL",
  "DISCARD",
  "EVAL",
  "EVALSHA",
  "FLUSHALL",
  "FLUSHDB",
  "FT.DROPINDEX",
  "HDEL",
  "JSON.ARRPOP",
  "JSON.CLEAR",
  "JSON.DEL",
  "JSON.FORGET",
  "LPOP",
  "LTRIM",
  "MOVE",
  "PERSIST",
  "PEXPIRE",
  "PEXPIREAT",
  "RENAME",
  "RENAMENX",
  "RESTORE",
  "RPOP",
  "SPOP",
  "SREM",
  "UNLINK",
  "XDEL",
  "XTRIM",
  "ZPOPMAX",
  "ZPOPMIN",
  "ZREM",
  "ZREMRANGEBYLEX",
  "ZREMRANGEBYRANK",
  "ZREMRANGEBYSCORE",
]);
