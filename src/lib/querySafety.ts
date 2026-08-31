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
  if (
    (normalizedDriver === "mongodb" || normalizedDriver === "mongo") &&
    looksLikeMongoShell(query)
  ) {
    return looksReadOnlyMongoShell(query);
  }
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

  if (containsDangerousSqlFunction(query)) return false;

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

  const statements = splitSqlStatements(query, normalizedDriver);
  if (statements.length !== 1) return false;
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
  if (
    (normalizedDriver === "mongodb" || normalizedDriver === "mongo") &&
    looksLikeMongoShell(query)
  ) {
    return looksDestructiveMongoShell(query);
  }
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

  if (containsDestructiveSqlFunction(query)) return true;

  return splitSqlStatements(query, normalizedDriver).some(
    looksDestructiveSqlStatement
  );
}

export function redisSelectedDatabase(query: string) {
  let selected: string | null = null;
  for (const line of parseRedisCommandLines(query)) {
    const match = line.match(/^\s*SELECT\s+["']?(\d+)["']?\s*$/i);
    if (match?.[1]) selected = match[1];
  }
  return selected;
}

const DANGEROUS_SQL_FUNCTIONS = [
  "benchmark",
  "dblink_connect",
  "dblink_connect_u",
  "dblink_exec",
  "get_lock",
  "last_insert_id",
  "load_file",
  "lo_export",
  "master_pos_wait",
  "nextval",
  "pg_advisory_lock",
  "pg_advisory_unlock",
  "pg_advisory_unlock_all",
  "pg_advisory_xact_lock",
  "pg_backup_start",
  "pg_backup_stop",
  "pg_cancel_backend",
  "pg_create_restore_point",
  "pg_logical_emit_message",
  "pg_notify",
  "pg_promote",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_switch_wal",
  "pg_terminate_backend",
  "pg_try_advisory_lock",
  "pg_try_advisory_xact_lock",
  "pg_write_file",
  "release_all_locks",
  "release_lock",
  "set_config",
  "setval",
  "sleep",
  "source_pos_wait",
  "sys_eval",
  "sys_exec",
] as const;

const DESTRUCTIVE_SQL_FUNCTIONS = [
  "pg_promote",
  "pg_reload_conf",
  "pg_terminate_backend",
  "sys_exec",
] as const;

function containsDangerousSqlFunction(sql: string) {
  return containsSqlFunctionName(sql, DANGEROUS_SQL_FUNCTIONS);
}

function containsDestructiveSqlFunction(sql: string) {
  return containsSqlFunctionName(sql, DESTRUCTIVE_SQL_FUNCTIONS);
}

function containsSqlFunctionName(sql: string, names: readonly string[]) {
  const normalized = sql.toLowerCase();
  return names.some((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(?:^|[^a-z0-9_$])(?:[\"\`]?)${escaped}(?:[\"\`]?)\\s*\\(`
    ).test(normalized);
  });
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
    if (
      /\binto\b/.test(normalized) ||
      /\block\s+in\s+share\s+mode\b/.test(normalized)
    ) {
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

function splitSqlStatements(query: string, driver?: string | null) {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarQuoteTag: string | null = null;
  const normalizedDriver = String(driver || "").trim().toLowerCase();
  const isMysql = normalizedDriver === "mysql" || normalizedDriver === "mariadb";
  const isPostgres = ["postgres", "postgresql", "pgsql", "psql"].includes(
    normalizedDriver
  );

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index]!;
    const next = query[index + 1] ?? "";

    if (dollarQuoteTag) {
      if (query.startsWith(dollarQuoteTag, index)) {
        current += " ".repeat(dollarQuoteTag.length);
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char === "\n" || char === "\r" ? char : " ";
      }
      continue;
    }

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
        current += " ";
      }
      continue;
    }

    if (blockCommentDepth > 0) {
      if (isPostgres && char === "/" && next === "*") {
        blockCommentDepth += 1;
        index += 1;
        continue;
      }
      if (char === "*" && next === "/") {
        blockCommentDepth -= 1;
        index += 1;
        current += " ";
      }
      continue;
    }

    if (
      !quote &&
      char === "-" &&
      next === "-" &&
      (!isMysql || /\s/.test(query[index + 2] ?? ""))
    ) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!quote && isMysql && char === "#") {
      lineComment = true;
      continue;
    }
    if (!quote && char === "/" && next === "*") {
      blockCommentDepth = 1;
      index += 1;
      continue;
    }

    if (!quote && isPostgres && char === "$") {
      const tag = query.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if (tag) {
        dollarQuoteTag = tag;
        current += " ".repeat(tag.length);
        index += tag.length - 1;
        continue;
      }
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

const READ_ONLY_MONGO_SHELL_METHODS = new Set([
  "aggregate",
  "count",
  "countDocuments",
  "dataSize",
  "distinct",
  "find",
  "findOne",
  "getIndexes",
  "stats",
  "storageSize",
  "totalIndexSize",
  "version",
]);

const MUTATING_MONGO_SHELL_METHODS = new Set([
  "createIndex",
  "deleteMany",
  "deleteOne",
  "drop",
  "dropIndex",
  "dropIndexes",
  "findOneAndDelete",
  "findOneAndReplace",
  "findOneAndUpdate",
  "insert",
  "insertMany",
  "insertOne",
  "runCommand",
  "update",
  "updateMany",
  "updateOne",
]);

const DESTRUCTIVE_MONGO_SHELL_METHODS = new Set([
  "deleteMany",
  "deleteOne",
  "drop",
  "dropIndex",
  "dropIndexes",
  "findOneAndDelete",
  "runCommand",
]);

const MONGO_SHELL_CHAIN_METHODS = new Set([
  "collation",
  "explain",
  "limit",
  "skip",
  "sort",
]);

function looksLikeMongoShell(query: string) {
  return /(?:^|[;\r\n])\s*(?:(?:\/\/|--)[^\r\n]*(?:\r?\n)|\/\*[\s\S]*?\*\/\s*)*(?:db\s*\.|show\s+(?:dbs|databases)\b)/iu.test(query);
}

function looksReadOnlyMongoShell(query: string) {
  if (/^\s*show\s+(?:dbs|databases)\s*;?\s*$/iu.test(query)) return true;
  const methods = mongoShellPrimaryMethods(query);
  return (
    methods.length > 0 &&
    methods.every((method) => READ_ONLY_MONGO_SHELL_METHODS.has(method)) &&
    !mongoShellHasWriteAggregation(query)
  );
}

function looksDestructiveMongoShell(query: string) {
  const methods = mongoShellPrimaryMethods(query);
  return (
    methods.some((method) => DESTRUCTIVE_MONGO_SHELL_METHODS.has(method)) ||
    mongoShellHasWriteAggregation(query)
  );
}

function mongoShellPrimaryMethods(query: string) {
  const methods = mongoShellMethodNames(query);
  return methods.filter(
    (method) =>
      method !== "getCollection" && !MONGO_SHELL_CHAIN_METHODS.has(method),
  );
}

function mongoShellMethodNames(query: string) {
  const methods: string[] = [];
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index] ?? "";
    const next = query[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if ((character === "/" && next === "/") || (character === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character !== ".") continue;
    const match = query.slice(index + 1).match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/u);
    if (match?.[1]) methods.push(match[1]);
  }
  return methods.filter(
    (method) =>
      READ_ONLY_MONGO_SHELL_METHODS.has(method) ||
      MUTATING_MONGO_SHELL_METHODS.has(method) ||
      MONGO_SHELL_CHAIN_METHODS.has(method) ||
      method === "getCollection",
  );
}

function mongoShellHasWriteAggregation(query: string) {
  if (!mongoShellMethodNames(query).includes("aggregate")) return false;
  return /\$(?:out|merge)\s*:/iu.test(mongoShellStructuralText(query));
}

function mongoShellStructuralText(query: string) {
  let result = "";
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < query.length; index += 1) {
    const character = query[index] ?? "";
    const next = query[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n" || character === "\r") {
        lineComment = false;
        result += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if ((character === "/" && next === "/") || (character === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character !== "'" && character !== '"' && character !== "`") {
      result += character;
      continue;
    }

    const delimiter = character;
    let content = "";
    let escaped = false;
    let closed = false;
    for (index += 1; index < query.length; index += 1) {
      const quoted = query[index] ?? "";
      if (escaped) {
        content += quoted;
        escaped = false;
      } else if (quoted === "\\") {
        escaped = true;
      } else if (quoted === delimiter) {
        closed = true;
        break;
      } else {
        content += quoted;
      }
    }
    if (!closed) return result;
    let lookahead = index + 1;
    while (/\s/u.test(query[lookahead] ?? "")) lookahead += 1;
    result += query[lookahead] === ":" ? content : " ";
  }
  return result;
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
    const [command, subcommand] = redisCommandTokens(line);
    if (!command) return false;
    if (READ_ONLY_REDIS_COMMANDS.has(command)) return true;
    return Boolean(
      subcommand && READ_ONLY_REDIS_COMMAND_PAIRS.has(`${command} ${subcommand}`)
    );
  });
}

function looksDestructiveRedisCommands(query: string) {
  return parseRedisCommandLines(query).some((line) => {
    const [command, subcommand] = redisCommandTokens(line);
    if (!command) return false;
    if (DESTRUCTIVE_REDIS_COMMANDS.has(command)) return true;
    return Boolean(
      subcommand && DESTRUCTIVE_REDIS_COMMAND_PAIRS.has(`${command} ${subcommand}`)
    );
  });
}

function redisCommandTokens(line: string) {
  return line
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((token) => token.replace(/^["']|["']$/g, "").toUpperCase());
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
  "COMMAND",
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
  "INFO",
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

const READ_ONLY_REDIS_COMMAND_PAIRS = new Set([
  "ACL CAT",
  "ACL GETUSER",
  "ACL LIST",
  "CLIENT ID",
  "CLIENT INFO",
  "CLIENT LIST",
  "CONFIG GET",
  "CONFIG HELP",
  "FUNCTION LIST",
  "FUNCTION STATS",
  "MEMORY STATS",
  "MEMORY USAGE",
  "SCRIPT EXISTS",
  "SCRIPT HELP",
  "SLOWLOG GET",
  "SLOWLOG LEN",
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
  "SHUTDOWN",
  "SWAPDB",
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

const DESTRUCTIVE_REDIS_COMMAND_PAIRS = new Set([
  "ACL DELUSER",
  "ACL LOAD",
  "ACL SAVE",
  "ACL SETUSER",
  "CLIENT KILL",
  "CLIENT PAUSE",
  "CONFIG RESETSTAT",
  "CONFIG REWRITE",
  "CONFIG SET",
  "FUNCTION DELETE",
  "FUNCTION FLUSH",
  "FUNCTION LOAD",
  "SCRIPT FLUSH",
  "SCRIPT KILL",
]);
