import type {
  RedisCommandArgument,
  RedisCommandDocumentation,
  RedisCommandKeySpec,
} from "@/lib/redisCommandDocs";
import { tokenizeRedisLine } from "@/lib/redisCommandTokenizer";

export interface RedisCompletionItem {
  label: string;
  type: "keyword" | "key" | "value";
  detail?: string;
  documentation?: string;
  insertText?: string;
  appendSpace?: boolean;
  sortText: string;
}

export interface RedisCompletionContext {
  mode: "command" | "subcommand" | "argument";
  prefix: string;
  from: number;
  mainCommand?: string;
  commandName?: string;
  argumentIndex?: number;
  argumentValues?: string[];
}

export interface RedisCompletionInput {
  commands: readonly RedisCommandDocumentation[];
  keys?: readonly string[];
}

type CommandIndex = {
  commands: Map<string, RedisCommandDocumentation>;
  mainCommands: RedisCommandDocumentation[];
  subcommands: Map<string, RedisCommandDocumentation[]>;
};

const commandIndexes = new WeakMap<ReadonlyArray<RedisCommandDocumentation>, CommandIndex>();

function commandIndex(commands: readonly RedisCommandDocumentation[]): CommandIndex {
  const cached = commandIndexes.get(commands);
  if (cached) return cached;
  const map = new Map<string, RedisCommandDocumentation>();
  commands.forEach((command) => map.set(command.name.toUpperCase(), command));
  const main = new Map<string, RedisCommandDocumentation>();
  const subcommands = new Map<string, RedisCommandDocumentation[]>();
  map.forEach((entry, name) => {
    const tokens = name.split(" ");
    const root = tokens[0]!;
    if (!main.has(root)) {
      main.set(root, map.get(root) ?? { ...entry, name: root });
    }
    for (let index = 1; index < tokens.length; index += 1) {
      const parent = tokens.slice(0, index).join(" ");
      const childName = tokens.slice(0, index + 1).join(" ");
      const children = subcommands.get(parent) ?? [];
      const child = map.get(childName) ?? { ...entry, name: childName };
      if (!children.some((candidate) => candidate.name === child.name)) children.push(child);
      subcommands.set(parent, children);
    }
  });
  const result = { commands: map, mainCommands: [...main.values()], subcommands };
  commandIndexes.set(commands, result);
  return result;
}

function matchesPrefix(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

export function getRedisCompletionContext(
  text: string,
  cursor: number,
  input: Pick<RedisCompletionInput, "commands">,
): RedisCompletionContext {
  const index = commandIndex(input.commands);
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const lineStart = text.lastIndexOf("\n", safeCursor - 1) + 1;
  const beforeCursor = text.slice(lineStart, safeCursor);
  const tokenized = tokenizeRedisLine(beforeCursor);
  const endsWithSpace = beforeCursor.length > 0 && /\s$/.test(beforeCursor);
  const currentToken = endsWithSpace
    ? undefined
    : tokenized.argv[tokenized.argv.length - 1];
  const currentWord = currentToken?.value ?? "";
  const from = currentToken ? lineStart + currentToken.startColumn - 1 : safeCursor;
  const tokens = tokenized.argv.map((token) => token.value);
  const completed = endsWithSpace ? tokens : tokens.slice(0, -1);
  if (completed.length === 0) return { mode: "command", prefix: currentWord, from };

  const normalized = completed.map((token) => token.toUpperCase());
  const mainCommand = normalized[0]!;
  const commandPrefix = normalized.join(" ");
  if (index.subcommands.has(commandPrefix)) {
    return {
      mode: "subcommand",
      prefix: currentWord,
      from,
      mainCommand,
      commandName: commandPrefix,
    };
  }

  let commandName: string | undefined;
  for (let count = normalized.length; count > 0; count -= 1) {
    const candidate = normalized.slice(0, count).join(" ");
    if (index.commands.has(candidate)) {
      commandName = candidate;
      break;
    }
  }
  const headLength = commandName?.split(" ").length ?? 1;
  const argumentsBeforeCursor = completed.slice(headLength);
  return {
    mode: "argument",
    prefix: currentWord,
    from,
    mainCommand,
    commandName: commandName ?? mainCommand,
    argumentIndex: argumentsBeforeCursor.length,
    argumentValues: argumentsBeforeCursor,
  };
}

function commandDocumentation(command: RedisCommandDocumentation): string {
  const lines: string[] = [];
  if (command.summary) lines.push(command.summary, "");
  lines.push(`Command: ${command.name}`);
  if (command.group) lines.push(`Group: ${command.group}`);
  if (command.arity !== undefined) {
    const count = Math.abs(command.arity) - 1;
    lines.push(command.arity < 0 ? `Arguments: at least ${count}` : `Arguments: exactly ${count}`);
  }
  if (command.since) lines.push(`Since Redis ${command.since}`);
  if (command.source === "fallback") {
    lines.push("Source: built-in common command fallback; server metadata was unavailable.");
  }
  return lines.join("\n");
}

function flattenArguments(arguments_: readonly RedisCommandArgument[]): RedisCommandArgument[] {
  return arguments_.flatMap((argument) => [
    argument,
    ...flattenArguments(argument.arguments ?? []),
  ]);
}

function argumentSuggestions(
  command: RedisCommandDocumentation,
  prefix: string,
): RedisCompletionItem[] {
  const values = new Map<string, { detail?: string; documentation?: string }>();
  flattenArguments(command.arguments ?? []).forEach((argument) => {
    if (argument.token) {
      values.set(argument.token.toUpperCase(), {
        detail: argument.optional ? "optional keyword" : "keyword",
        documentation: argument.summary,
      });
    }
    argument.enum?.forEach((value) => {
      values.set(value.toUpperCase(), {
        detail: argument.name,
        documentation: argument.summary,
      });
    });
  });
  return [...values.entries()]
    .filter(([value]) => matchesPrefix(value, prefix))
    .map(([value, metadata], index) => ({
      label: value,
      type: "value" as const,
      detail: metadata.detail,
      documentation: metadata.documentation,
      appendSpace: true,
      sortText: `1:${String(index).padStart(4, "0")}:${value}`,
    }));
}

function positionMatchesRange(
  spec: RedisCommandKeySpec,
  argumentIndex: number,
  argumentValues: readonly string[],
): boolean {
  let first: number;
  if (spec.beginSearch.type === "index") {
    // Redis key specs count the command itself as index 0; completion argument
    // indexes start after the fully resolved command head.
    first = Math.max(0, spec.beginSearch.index - 1);
  } else {
    const keyword = spec.beginSearch.keyword;
    const keywordIndex = argumentValues.findIndex(
      (value) => value.toUpperCase() === keyword,
    );
    if (keywordIndex < 0) return false;
    first = keywordIndex + spec.beginSearch.startFrom;
  }
  if (argumentIndex < first) return false;
  if (spec.findKeys.type === "keynum") {
    const count = Number(argumentValues[first + spec.findKeys.keyNumIndex]);
    const keyStart = first + spec.findKeys.firstKey;
    return Number.isFinite(count) &&
      argumentIndex >= keyStart &&
      argumentIndex < keyStart + count * spec.findKeys.keyStep &&
      (argumentIndex - keyStart) % spec.findKeys.keyStep === 0;
  }
  const offset = argumentIndex - first;
  if (offset % spec.findKeys.keyStep !== 0) return false;
  if (spec.findKeys.lastKey < 0) return true;
  return offset <= spec.findKeys.lastKey;
}

export function takesRedisKeyArgument(
  commandName: string | undefined,
  input: Pick<RedisCompletionInput, "commands">,
  argumentIndex = 0,
  argumentValues: readonly string[] = [],
): boolean {
  if (!commandName) return false;
  const command = commandIndex(input.commands).commands.get(commandName.toUpperCase());
  return Boolean(
    command?.keySpecs.some((spec) =>
      positionMatchesRange(spec, argumentIndex, argumentValues),
    ),
  );
}

export function buildRedisCompletionItems(
  context: RedisCompletionContext,
  input: RedisCompletionInput,
): RedisCompletionItem[] {
  const index = commandIndex(input.commands);
  if (context.mode === "command") {
    return index.mainCommands
      .filter((command) => matchesPrefix(command.name, context.prefix))
      .map((command, itemIndex) => ({
        label: command.name,
        type: "keyword" as const,
        detail: command.group || "Redis command",
        documentation: commandDocumentation(command),
        appendSpace: true,
        sortText: `0:${String(itemIndex).padStart(4, "0")}:${command.name}`,
      }));
  }

  if (context.mode === "subcommand") {
    const children = index.subcommands.get(context.commandName ?? "") ?? [];
    return children
      .map((command) => ({
        command,
        token: command.name.slice((context.commandName?.length ?? 0) + 1).split(" ")[0]!,
      }))
      .filter(({ token }) => matchesPrefix(token, context.prefix))
      .map(({ command, token }, itemIndex) => ({
        label: token,
        type: "keyword" as const,
        detail: command.group || "Redis subcommand",
        documentation: commandDocumentation(command),
        appendSpace: true,
        sortText: `0:${String(itemIndex).padStart(4, "0")}:${token}`,
      }));
  }

  const command = index.commands.get((context.commandName ?? "").toUpperCase());
  if (!command) return [];
  const argumentItems = argumentSuggestions(command, context.prefix);
  if (
    !takesRedisKeyArgument(
      command.name,
      input,
      context.argumentIndex,
      context.argumentValues,
    )
  ) {
    return argumentItems;
  }
  const keyItems = (input.keys ?? [])
    .filter((key) => matchesPrefix(key, context.prefix))
    .map((key, itemIndex) => ({
      label: key,
      type: "key" as const,
      detail: "Redis key",
      documentation: `Existing key in the selected logical database.`,
      insertText: /\s|["'\\]/.test(key)
        ? `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
        : key,
      appendSpace: true,
      sortText: `0:${String(itemIndex).padStart(4, "0")}:${key}`,
    }));
  return [...keyItems, ...argumentItems];
}
