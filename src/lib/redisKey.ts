export type RedisKeyType =
  | "string"
  | "list"
  | "set"
  | "hash"
  | "zset"
  | "stream";

export interface RedisKeyDraft {
  name: string;
  type: RedisKeyType;
  value: string;
  ttlSeconds?: number | null;
}

export interface RedisKeyTreeNode<T extends { name: string }> {
  segment: string;
  path: string;
  key?: T;
  children: RedisKeyTreeNode<T>[];
  keyCount: number;
}

export function buildRedisKeyTree<T extends { name: string }>(
  keys: readonly T[]
): RedisKeyTreeNode<T>[] {
  type MutableNode = {
    segment: string;
    path: string;
    key?: T;
    children: Map<string, MutableNode>;
  };

  const roots = new Map<string, MutableNode>();
  for (const key of keys) {
    const segments = key.name.split(":");
    let siblings = roots;
    const path: string[] = [];
    segments.forEach((segment, index) => {
      path.push(segment);
      let node = siblings.get(segment);
      if (!node) {
        node = {
          segment,
          path: path.join(":"),
          children: new Map(),
        };
        siblings.set(segment, node);
      }
      if (index === segments.length - 1) node.key = key;
      siblings = node.children;
    });
  }

  const finalize = (nodes: Map<string, MutableNode>): RedisKeyTreeNode<T>[] =>
    Array.from(nodes.values())
      .sort((left, right) =>
        left.segment.localeCompare(right.segment, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      )
      .map((node) => {
        const children = finalize(node.children);
        return {
          segment: node.segment,
          path: node.path,
          key: node.key,
          children,
          keyCount:
            (node.key ? 1 : 0) +
            children.reduce((total, child) => total + child.keyCount, 0),
        };
      });

  return finalize(roots);
}

export const REDIS_KEY_TYPES: Array<{
  value: RedisKeyType;
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    value: "string",
    label: "String",
    hint: "A single text value",
    placeholder: "Value",
  },
  {
    value: "list",
    label: "List",
    hint: "One item per line, in insertion order",
    placeholder: "first item\nsecond item",
  },
  {
    value: "set",
    label: "Set",
    hint: "One unique member per line",
    placeholder: "member-a\nmember-b",
  },
  {
    value: "hash",
    label: "Hash",
    hint: "One field=value pair per line",
    placeholder: "name=Ada\nrole=admin",
  },
  {
    value: "zset",
    label: "Sorted Set",
    hint: "One score member pair per line",
    placeholder: "10 member-a\n20 member-b",
  },
  {
    value: "stream",
    label: "Stream",
    hint: "Fields for the first auto-ID entry",
    placeholder: "event=created\nactor=admin",
  },
];

function quoteRedisArgument(value: string) {
  return JSON.stringify(value);
}

function nonEmptyLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fieldValueArguments(value: string, label: string) {
  const args: string[] = [];
  for (const line of nonEmptyLines(value)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`${label} entries must use field=value.`);
    }
    args.push(
      quoteRedisArgument(line.slice(0, separator).trim()),
      quoteRedisArgument(line.slice(separator + 1))
    );
  }
  if (args.length === 0) {
    throw new Error(`${label} requires at least one field.`);
  }
  return args;
}

export function buildRedisCreateKeyCommand(draft: RedisKeyDraft) {
  const name = draft.name.trim();
  if (!name) throw new Error("Key name is required.");

  const key = quoteRedisArgument(name);
  let command: string;
  switch (draft.type) {
    case "string":
      command = `SET ${key} ${quoteRedisArgument(draft.value)}`;
      break;
    case "list": {
      const values = nonEmptyLines(draft.value).map(quoteRedisArgument);
      if (values.length === 0) throw new Error("List requires at least one item.");
      command = `RPUSH ${key} ${values.join(" ")}`;
      break;
    }
    case "set": {
      const values = nonEmptyLines(draft.value).map(quoteRedisArgument);
      if (values.length === 0) throw new Error("Set requires at least one member.");
      command = `SADD ${key} ${values.join(" ")}`;
      break;
    }
    case "hash":
      command = `HSET ${key} ${fieldValueArguments(draft.value, "Hash").join(" ")}`;
      break;
    case "zset": {
      const args: string[] = [];
      for (const line of nonEmptyLines(draft.value)) {
        const match = line.match(/^(\S+)\s+(.+)$/);
        if (!match || !Number.isFinite(Number(match[1]))) {
          throw new Error("Sorted Set entries must use score member.");
        }
        args.push(match[1]!, quoteRedisArgument(match[2]!));
      }
      if (args.length === 0) {
        throw new Error("Sorted Set requires at least one member.");
      }
      command = `ZADD ${key} ${args.join(" ")}`;
      break;
    }
    case "stream":
      command = `XADD ${key} * ${fieldValueArguments(draft.value, "Stream").join(" ")}`;
      break;
  }

  if (draft.ttlSeconds !== null && draft.ttlSeconds !== undefined) {
    if (!Number.isInteger(draft.ttlSeconds) || draft.ttlSeconds <= 0) {
      throw new Error("TTL must be a positive whole number of seconds.");
    }
    command += `\nEXPIRE ${key} ${draft.ttlSeconds}`;
  }

  return command;
}
