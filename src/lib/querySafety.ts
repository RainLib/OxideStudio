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
    "lock",
    "merge",
    "replace",
    "revoke",
    "set",
    "truncate",
    "update",
    "vacuum",
  ];

  const statements = splitSqlStatements(query);
  if (statements.length === 0) return false;
  return statements.every((statement) =>
    looksReadOnlySqlStatement(statement, mutatingSqlPrefixes)
  );
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

  return splitSqlStatements(query).some(looksDestructiveSqlStatement);
}

function looksReadOnlySqlStatement(
  statement: string,
  mutatingSqlPrefixes: string[]
) {
  const keywordText = sqlKeywordText(statement);
  const normalized = keywordText.trim().toLowerCase();
  if (!normalized) return false;

  const firstKeyword = normalized.match(/^[a-z_]+/)?.[0] ?? "";
  if (firstKeyword === "show" || firstKeyword === "describe" || firstKeyword === "desc") {
    return true;
  }
  if (
    firstKeyword === "select" ||
    firstKeyword === "table" ||
    firstKeyword === "values" ||
    firstKeyword === "explain" ||
    firstKeyword === "with"
  ) {
    if (/\bfor\s+(update|no\s+key\s+update|share|key\s+share)\b/.test(normalized)) {
      return false;
    }
    return !mutatingSqlPrefixes.some((keyword) =>
      new RegExp(`\\b${keyword}\\b`).test(normalized)
    );
  }

  return false;
}

function looksDestructiveSqlStatement(statement: string) {
  const normalized = sqlKeywordText(statement).trim().toLowerCase();
  if (!normalized) return false;

  const firstKeyword = normalized.match(/^[a-z_]+/)?.[0] ?? "";
  if (["delete", "drop", "truncate"].includes(firstKeyword)) {
    return true;
  }
  return (
    /\bdrop\s+(database|schema|table|view|materialized\s+view|index|function|procedure|trigger|constraint)\b/.test(
      normalized
    ) ||
    /\bdelete\s+from\b/.test(normalized) ||
    /\btruncate\s+(table\s+)?\w/.test(normalized) ||
    /\balter\s+table\b[\s\S]*\bdrop\b/.test(normalized)
  );
}

function splitSqlStatements(query: string) {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    const next = query[index + 1] ?? "";

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        current += " ";
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
        current += " ";
      }
      continue;
    }

    if (!quote && char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!quote && char === "#") {
      lineComment = true;
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (quote) {
      current += char;
      if (char === "\\" && next) {
        current += next;
        index += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          current += next;
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const statement = current.trim();
  if (statement) statements.push(statement);
  return statements;
}

function sqlKeywordText(statement: string) {
  let result = "";
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index]!;
    const next = statement[index + 1] ?? "";

    if (quote) {
      result += " ";
      if (char === "\\" && next) {
        result += " ";
        index += 1;
        continue;
      }
      if (char === quote) {
        if (next === quote) {
          result += " ";
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      result += " ";
      continue;
    }

    result += char;
  }

  return result;
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
    const operations = keys.filter((key) => MONGO_OPERATION_KEYS.has(key));

    if (operations.length === 0) {
      return (
        typeof payload.collection === "string" &&
        keys.every((key) => READ_ONLY_MONGO_FIND_FIELDS.has(key))
      );
    }
    if (operations.length > 1) return false;

    const operation = operations[0];
    if (!operation) return false;
    if (operation === "aggregate") {
      return mongoPipelineIsReadOnly(payload.aggregate);
    }
    if (["find", "countdocuments"].includes(operation)) {
      return true;
    }
    if (operation !== "command") return false;

    const commandBody = payload.command;
    if (!commandBody || typeof commandBody !== "object" || Array.isArray(commandBody)) {
      return false;
    }
    const [commandName] = Object.keys(commandBody);
    if (commandName?.toLowerCase() === "aggregate") {
      return mongoPipelineIsReadOnly(
        (commandBody as Record<string, unknown>).pipeline
      );
    }
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
    if (mongoPipelineHasWriteStage(payload.aggregate)) {
      return true;
    }
    if (
      keys.some((key) =>
        [
          "collmod",
          "delete",
          "deleteone",
          "deletemany",
          "drop",
          "dropdatabase",
          "dropindexes",
          "findandmodify",
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
    if (
      mongoPipelineHasWriteStage(
        (commandBody as Record<string, unknown>).pipeline
      )
    ) {
      return true;
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

function mongoPipelineIsReadOnly(value: unknown) {
  return Array.isArray(value) && !mongoPipelineHasWriteStage(value);
}

function mongoPipelineHasWriteStage(value: unknown) {
  if (!Array.isArray(value)) return false;

  return value.some((stage) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      return false;
    }

    return Object.keys(stage as Record<string, unknown>).some((key) =>
      ["$out", "$merge"].includes(key.toLowerCase())
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

const MONGO_OPERATION_KEYS = new Set([
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
]);

const READ_ONLY_MONGO_FIND_FIELDS = new Set([
  "collection",
  "database",
  "find",
  "limit",
  "projection",
  "skip",
  "sort",
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
  const normalized = query.toLowerCase();
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
      (path.includes("_bulk") && normalized.includes('"delete"')) ||
      (path.includes("_aliases") && normalized.includes('"remove_index"')) ||
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
  const commands: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escape = false;
  let lineComment = false;

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) commands.push(trimmed);
    current = "";
  };

  for (const char of query) {
    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        pushCurrent();
      }
      continue;
    }

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (quote && char === "\\") {
      current += char;
      escape = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }

    if (char === "#" && !current.trim()) {
      lineComment = true;
      continue;
    }

    if (char === ";" || char === "\n" || char === "\r") {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();
  return commands;
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
