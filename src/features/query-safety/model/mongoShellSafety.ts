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

export function looksLikeMongoShell(query: string) {
  return /(?:^|[;\r\n])\s*(?:(?:\/\/|--)[^\r\n]*(?:\r?\n)|\/\*[\s\S]*?\*\/\s*)*(?:db\s*\.|show\s+(?:dbs|databases)\b)/iu.test(
    query,
  );
}

export function looksReadOnlyMongoShell(query: string) {
  if (/^\s*show\s+(?:dbs|databases)\s*;?\s*$/iu.test(query)) return true;
  const methods = mongoShellPrimaryMethods(query);
  return (
    methods.length > 0 &&
    methods.every((method) => READ_ONLY_MONGO_SHELL_METHODS.has(method)) &&
    !mongoShellHasWriteAggregation(query)
  );
}

export function looksDestructiveMongoShell(query: string) {
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
    if (
      (character === "/" && next === "/") ||
      (character === "-" && next === "-")
    ) {
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
    const match = query
      .slice(index + 1)
      .match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/u);
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
    if (
      (character === "/" && next === "/") ||
      (character === "-" && next === "-")
    ) {
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
