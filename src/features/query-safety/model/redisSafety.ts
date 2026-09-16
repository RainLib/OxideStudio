export function redisSelectedDatabase(query: string) {
  let selected: string | null = null;
  for (const line of parseRedisCommandLines(query)) {
    const match = line.match(/^\s*SELECT\s+["']?(\d+)["']?\s*$/i);
    if (match?.[1]) selected = match[1];
  }
  return selected;
}

export function looksReadOnlyRedisCommands(query: string) {
  const commands = parseRedisCommandLines(query);
  if (commands.length === 0) return false;

  return commands.every((line) => {
    const [command, subcommand] = redisCommandTokens(line);
    if (!command) return false;
    if (READ_ONLY_REDIS_COMMANDS.has(command)) return true;
    return Boolean(
      subcommand &&
        READ_ONLY_REDIS_COMMAND_PAIRS.has(`${command} ${subcommand}`),
    );
  });
}

export function looksDestructiveRedisCommands(query: string) {
  return parseRedisCommandLines(query).some((line) => {
    const [command, subcommand] = redisCommandTokens(line);
    if (!command) return false;
    if (DESTRUCTIVE_REDIS_COMMANDS.has(command)) return true;
    return Boolean(
      subcommand &&
        DESTRUCTIVE_REDIS_COMMAND_PAIRS.has(`${command} ${subcommand}`),
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
