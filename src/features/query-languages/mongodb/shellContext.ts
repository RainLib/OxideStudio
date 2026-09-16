import { mongodbJsonCompletionContext } from "@/features/query-languages/mongodb/jsonContext";
import { clampOffset } from "@/features/query-languages/mongodb/jsonScanner";
import { MONGODB_SHELL_ARGUMENT_ROLES } from "@/features/query-languages/mongodb/shellCatalog";
import { type MongoDbCompletionContext } from "@/features/query-languages/mongodb/types";

function mongodbShellCollection(beforeCursor: string) {
  const getCollection = beforeCursor.match(
    /\bdb\.getCollection\(\s*(["'])(.*?)\1\s*\)/su,
  );
  if (getCollection?.[2]) return getCollection[2];
  return beforeCursor.match(/\bdb\.([\p{L}\p{N}_-]+)/u)?.[1];
}

function mongodbShellCursorIsInComment(source: string) {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";
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
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
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
    }
  }
  return lineComment || blockComment;
}

function mongodbShellFindChainAllowsCount(beforeCursor: string) {
  if (!/\.find\s*\(/u.test(beforeCursor)) return false;
  return (beforeCursor.match(/\)\s*\./gu) || []).length === 1;
}

type MongoShellCallContext = {
  method: string;
  argumentIndex: number;
  argumentSource: string;
};

function activeMongoShellCall(
  beforeCursor: string,
): MongoShellCallContext | null {
  const stack: Array<{
    delimiter: "(" | "[" | "{";
    method?: string;
    argumentStart?: number;
    argumentIndex?: number;
  }> = [];
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < beforeCursor.length; index += 1) {
    const character = beforeCursor[index] ?? "";
    const next = beforeCursor[index + 1] ?? "";
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
    if (character === ".") {
      const match = beforeCursor
        .slice(index + 1)
        .match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/u);
      const method = match?.[1];
      if (method && MONGODB_SHELL_ARGUMENT_ROLES[method]) {
        const openOffset = match[0].lastIndexOf("(");
        const open = index + 1 + openOffset;
        stack.push({
          delimiter: "(",
          method,
          argumentStart: open + 1,
          argumentIndex: 0,
        });
        index = open;
        continue;
      }
    }
    if (character === "(" || character === "[" || character === "{") {
      stack.push({ delimiter: character });
      continue;
    }
    if (character === ",") {
      const call = [...stack].reverse().find((frame) => frame.method);
      if (call && stack[stack.length - 1] === call) {
        call.argumentIndex = (call.argumentIndex ?? 0) + 1;
        call.argumentStart = index + 1;
      }
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      const expected = character === ")" ? "(" : character === "]" ? "[" : "{";
      if (stack[stack.length - 1]?.delimiter === expected) stack.pop();
    }
  }

  const call = [...stack].reverse().find((frame) => frame.method);
  if (!call?.method || call.argumentStart === undefined) return null;
  return {
    method: call.method,
    argumentIndex: call.argumentIndex ?? 0,
    argumentSource: beforeCursor.slice(call.argumentStart),
  };
}

function mongodbShellArgumentContext(
  beforeCursor: string,
  collection: string | undefined,
): MongoDbCompletionContext | null {
  const call = activeMongoShellCall(beforeCursor);
  if (!call) return null;
  const role = MONGODB_SHELL_ARGUMENT_ROLES[call.method]?.[call.argumentIndex];
  if (!role) return null;
  const typed = call.argumentSource.match(/[A-Za-z0-9_$.-]+$/u)?.[0] || "";
  if (role === "options") {
    return {
      area: "shell-option",
      typed,
      parentKey: call.method,
      collection,
      syntax: "shell",
    };
  }
  if (role === "fieldName") {
    return {
      area: "field",
      typed: typed.replace(/^\$/u, ""),
      parentKey: call.method,
      collection,
      syntax: "shell",
      quoted: /["'][^"']*$/u.test(call.argumentSource),
    };
  }

  const ownerKey = role === "replacement" ? "insertOne" : role;
  const wrapper = `{ "${ownerKey}": ${call.argumentSource}`;
  const nested = mongodbJsonCompletionContext(wrapper, wrapper.length);
  return {
    ...nested,
    collection,
    syntax: "shell",
  };
}

export function mongodbShellCompletionContext(
  source: string,
  cursorOffset: number,
): MongoDbCompletionContext | null {
  const beforeCursor = source.slice(0, clampOffset(source, cursorOffset));
  const trimmed = beforeCursor.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;

  if (mongodbShellCursorIsInComment(beforeCursor)) {
    return { area: "unknown", typed: "", syntax: "shell" };
  }

  // Argument classification must run before the trailing `db.x.y` patterns:
  // a method-shaped string value is data, not another MongoDB command chain.
  const argumentContext = mongodbShellArgumentContext(
    beforeCursor,
    mongodbShellCollection(beforeCursor),
  );
  if (argumentContext) return argumentContext;

  const chain = beforeCursor.match(/\)\s*\.\s*([A-Za-z]*)$/u);
  if (chain) {
    return {
      area: "shell-chain",
      typed: chain[1] || "",
      collection: mongodbShellCollection(beforeCursor),
      parentKey: mongodbShellFindChainAllowsCount(beforeCursor)
        ? "find-countable"
        : undefined,
      syntax: "shell",
    };
  }

  const qualified = beforeCursor.match(
    /\bdb\.([\p{L}\p{N}_.-]*\.[\p{L}\p{N}_.-]*)$/u,
  );
  if (qualified) {
    const typed = qualified[1] || "";
    return {
      area: "shell-qualified",
      typed,
      collection: typed.split(".", 1)[0] || undefined,
      replacementLength: typed.length,
      syntax: "shell",
    };
  }

  const method = beforeCursor.match(
    /\bdb\.getCollection\(\s*(["']).*?\1\s*\)\s*\.\s*([A-Za-z]*)$/su,
  );
  if (method) {
    return {
      area: "shell-method",
      typed: method[2] || "",
      collection: mongodbShellCollection(beforeCursor),
      syntax: "shell",
    };
  }

  const collection = beforeCursor.match(/\bdb\.([\p{L}\p{N}_.-]*)$/u);
  if (collection) {
    return {
      area: "collection",
      typed: collection[1] || "",
      syntax: "shell",
    };
  }

  if (
    /^\s*(?:(?:d|db)|(?:s|sh|sho|show|show\s+d|show\s+db|show\s+dat|show\s+data)|(?:u|us|use))?\s*$/iu.test(
      beforeCursor,
    )
  ) {
    return {
      area: "shell-root",
      typed: beforeCursor.trim(),
      syntax: "shell",
    };
  }

  return trimmed.startsWith("db.")
    ? {
        area: "unknown",
        typed: beforeCursor.match(/[A-Za-z0-9_$.-]+$/u)?.[0] || "",
        collection: mongodbShellCollection(beforeCursor),
        syntax: "shell",
      }
    : null;
}
