export interface RedisCommandArgument {
  name: string;
  token?: string;
  type?: string;
  summary?: string;
  since?: string;
  optional?: boolean;
  multiple?: boolean;
  multipleToken?: boolean;
  enum?: string[];
  arguments?: RedisCommandArgument[];
}

export interface RedisCommandKeySpec {
  beginSearch:
    | { type: "index"; index: number }
    | { type: "keyword"; keyword: string; startFrom: number };
  findKeys:
    | { type: "range"; lastKey: number; keyStep: number; limit: number }
    | { type: "keynum"; keyNumIndex: number; firstKey: number; keyStep: number };
}

export interface RedisCommandDocumentation {
  name: string;
  summary?: string;
  since?: string;
  group?: string;
  arity?: number;
  keySpecs: RedisCommandKeySpec[];
  arguments?: RedisCommandArgument[];
  source?: "server" | "fallback";
}

type RedisRecord = Record<string, unknown>;

function mapEntries(value: unknown): Array<[string, unknown]> {
  if (Array.isArray(value)) {
    if (
      value.length > 0 &&
      value.length % 2 === 0 &&
      value.every((item, index) => index % 2 !== 0 || typeof item === "string")
    ) {
      const entries: Array<[string, unknown]> = [];
      for (let index = 0; index < value.length; index += 2) {
        entries.push([value[index] as string, value[index + 1]]);
      }
      return entries;
    }
    return value.flatMap((item): Array<[string, unknown]> => {
      if (Array.isArray(item) && typeof item[0] === "string") {
        return [[item[0], item[1]]];
      }
      if (
        item &&
        typeof item === "object" &&
        "key" in item &&
        "value" in item &&
        typeof item.key === "string"
      ) {
        return [[item.key, item.value]];
      }
      return [];
    });
  }
  return value && typeof value === "object" ? Object.entries(value) : [];
}

function recordFromMap(value: unknown): RedisRecord {
  return Object.fromEntries(mapEntries(value));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function enabledFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function normalizeCommandName(value: string): string {
  return value.trim().replace(/\|/g, " ").toUpperCase();
}

function argumentFlags(value: unknown): Set<string> {
  return new Set(
    (Array.isArray(value) ? value : [])
      .filter((flag): flag is string => typeof flag === "string")
      .map((flag) => flag.trim().toLowerCase().replace(/-/g, "_")),
  );
}

function commandArguments(value: unknown): RedisCommandArgument[] {
  return (Array.isArray(value) ? value : []).flatMap((rawArgument) => {
    const argument = recordFromMap(rawArgument);
    const name = optionalString(argument.name);
    if (!name) return [];
    const flags = argumentFlags(argument.flags);
    const nested = commandArguments(argument.arguments);
    const enumValues = (Array.isArray(argument.enum) ? argument.enum : []).filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );
    return [{
      name,
      token: optionalString(argument.token)?.toUpperCase(),
      type: optionalString(argument.type),
      summary: optionalString(argument.summary),
      since: optionalString(argument.since),
      optional: enabledFlag(argument.optional) || flags.has("optional") || undefined,
      multiple: enabledFlag(argument.multiple) || flags.has("multiple") || undefined,
      multipleToken:
        enabledFlag(argument.multiple_token) || flags.has("multiple_token") || undefined,
      enum: enumValues.length ? enumValues : undefined,
      arguments: nested.length ? nested : undefined,
    }];
  });
}

function commandKeySpecs(value: unknown): RedisCommandKeySpec[] {
  const result: RedisCommandKeySpec[] = [];
  for (const rawSpec of Array.isArray(value) ? value : []) {
    const spec = recordFromMap(rawSpec);
    const beginSearch = recordFromMap(spec.begin_search);
    const findKeys = recordFromMap(spec.find_keys);
    const beginSpec = recordFromMap(beginSearch.spec);
    const findSpec = recordFromMap(findKeys.spec);
    const keyStep = optionalNumber(findSpec.keystep);
    if (!keyStep || keyStep < 1) continue;
    const beginType = optionalString(beginSearch.type);
    const begin = beginType === "index"
      ? optionalNumber(beginSpec.index)
      : beginType === "keyword"
        ? optionalString(beginSpec.keyword)
        : undefined;
    const normalizedBegin = typeof begin === "number" && begin > 0
      ? { type: "index" as const, index: begin }
      : typeof begin === "string"
        ? {
            type: "keyword" as const,
            keyword: begin.toUpperCase(),
            startFrom: optionalNumber(beginSpec.startfrom) ?? 1,
          }
        : undefined;
    if (!normalizedBegin) continue;
    const findType = optionalString(findKeys.type);
    if (findType === "range") {
      const lastKey = optionalNumber(findSpec.lastkey);
      if (lastKey === undefined) continue;
      result.push({
        beginSearch: normalizedBegin,
        findKeys: {
          type: "range" as const,
          lastKey,
          keyStep,
          limit: optionalNumber(findSpec.limit) ?? 0,
        },
      });
      continue;
    }
    if (findType === "keynum") {
      const keyNumIndex = optionalNumber(findSpec.keynumidx);
      const firstKey = optionalNumber(findSpec.firstkey);
      if (keyNumIndex === undefined || firstKey === undefined) continue;
      result.push({
        beginSearch: normalizedBegin,
        findKeys: { type: "keynum" as const, keyNumIndex, firstKey, keyStep },
      });
    }
  }
  return result;
}

function legacyKeySpecs(value: readonly unknown[]): RedisCommandKeySpec[] {
  const firstKey = optionalNumber(value[3]);
  const lastKey = optionalNumber(value[4]);
  const keyStep = optionalNumber(value[5]);
  if (firstKey === undefined || firstKey < 1 || lastKey === undefined || !keyStep) return [];
  return [{
    beginSearch: { type: "index", index: firstKey },
    findKeys: {
      type: "range",
      lastKey: lastKey < 0 ? lastKey : Math.max(0, lastKey - firstKey),
      keyStep,
      limit: 0,
    },
  }];
}

export function parseRedisCommandDocumentation(value: unknown): RedisCommandDocumentation[] {
  const docs = new Map<string, RedisCommandDocumentation>();
  const collect = (rawDocs: unknown) => {
    for (const [rawName, rawDoc] of mapEntries(rawDocs)) {
      const name = normalizeCommandName(rawName);
      if (!name) continue;
      const doc = recordFromMap(rawDoc);
      const args = commandArguments(doc.arguments);
      docs.set(name, {
        name,
        summary: optionalString(doc.summary),
        since: optionalString(doc.since),
        group: optionalString(doc.group),
        arity: optionalNumber(doc.arity),
        keySpecs: commandKeySpecs(doc.key_specs),
        arguments: args.length ? args : undefined,
        source: "server",
      });
      if (doc.subcommands) collect(doc.subcommands);
    }
  };
  collect(value);
  return [...docs.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function parseRedisCommandCatalog(value: unknown): RedisCommandDocumentation[] {
  const docs = new Map<string, RedisCommandDocumentation>();
  const collect = (raw: unknown) => {
    if (
      Array.isArray(raw) &&
      typeof raw[0] === "string" &&
      optionalNumber(raw[1]) !== undefined &&
      Array.isArray(raw[2])
    ) {
      const name = normalizeCommandName(raw[0]);
      docs.set(name, {
        name,
        arity: optionalNumber(raw[1]),
        keySpecs: legacyKeySpecs(raw),
        source: "server",
      });
      collect(raw[9]);
      return;
    }
    if (Array.isArray(raw)) raw.forEach(collect);
    else if (raw && typeof raw === "object") {
      const record = raw as RedisRecord;
      if ("value" in record) collect(record.value);
      else Object.values(record).forEach(collect);
    }
  };
  collect(value);
  return [...docs.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function mergeRedisCommandDocumentation(
  documentation: readonly RedisCommandDocumentation[],
  catalog: readonly RedisCommandDocumentation[],
): RedisCommandDocumentation[] {
  const merged = new Map(catalog.map((command) => [command.name, command]));
  documentation.forEach((command) => {
    const catalogCommand = merged.get(command.name);
    merged.set(command.name, {
      ...catalogCommand,
      ...command,
      arity: command.arity ?? catalogCommand?.arity,
      keySpecs: command.keySpecs.length
        ? command.keySpecs
        : (catalogCommand?.keySpecs ?? []),
    });
  });
  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}

const COMMON_REDIS_COMMANDS: Array<[string, number, string, string]> = [
  ["GET", 2, "string", "Get the value of a key"],
  ["SET", -3, "string", "Set the string value of a key"],
  ["DEL", -2, "generic", "Delete one or more keys"],
  ["EXISTS", -2, "generic", "Determine whether keys exist"],
  ["EXPIRE", 3, "generic", "Set a key timeout in seconds"],
  ["TTL", 2, "generic", "Get a key timeout in seconds"],
  ["TYPE", 2, "generic", "Determine the type stored at a key"],
  ["SCAN", -2, "generic", "Incrementally iterate the key space"],
  ["MGET", -2, "string", "Get the values of multiple keys"],
  ["MSET", -3, "string", "Set multiple key-value pairs"],
  ["INCR", 2, "string", "Increment the integer value of a key"],
  ["DECR", 2, "string", "Decrement the integer value of a key"],
  ["HGET", 3, "hash", "Get the value of a hash field"],
  ["HSET", -4, "hash", "Set one or more hash fields"],
  ["HGETALL", 2, "hash", "Get all fields and values in a hash"],
  ["LPUSH", -3, "list", "Prepend values to a list"],
  ["RPUSH", -3, "list", "Append values to a list"],
  ["LRANGE", 4, "list", "Get a range of list elements"],
  ["SADD", -3, "set", "Add members to a set"],
  ["SMEMBERS", 2, "set", "Get all members in a set"],
  ["ZADD", -4, "sorted-set", "Add members to a sorted set"],
  ["ZRANGE", -4, "sorted-set", "Get a range of sorted-set members"],
  ["PING", -1, "connection", "Ping the server"],
  ["INFO", -1, "server", "Get server information"],
  ["CLIENT LIST", 2, "connection", "List connected clients"],
];

/** Safe discoverability fallback when COMMAND metadata is unavailable. */
export function commonRedisCommandDocumentation(): RedisCommandDocumentation[] {
  return COMMON_REDIS_COMMANDS.map(([name, arity, group, summary]) => ({
    name,
    arity,
    group,
    summary,
    source: "fallback",
    keySpecs: ["PING", "INFO", "CLIENT LIST", "SCAN"].includes(name)
      ? []
      : [{
          beginSearch: { type: "index", index: 1 },
          findKeys: { type: "range", lastKey: 0, keyStep: 1, limit: 0 },
        }],
  }));
}
