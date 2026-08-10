import { CompletionItemKind, type CompletionItem } from "@/services/lsp/types";

export type SqlCompletionItemType =
  | "keyword"
  | "table"
  | "column"
  | "snippet"
  | "function"
  | "schema"
  | "variable"
  | "property"
  | "text";

const COMPLETION_SPACE_BLOCKING_CHARACTERS = new Set([
  ",",
  ";",
  ":",
  ")",
  "]",
  "}",
  "'",
  '"',
]);
const MAX_COMPLETION_SIGNATURE_LENGTH = 16 * 1024;
const MAX_COMPLETION_SIGNATURE_PARAMETERS = 64;
const COMPLETION_GENERIC_TYPE_NAMES = new Set([
  "array",
  "list",
  "map",
  "row",
  "struct",
  "tuple",
]);

function opensCompletionGenericType(value: string, index: number) {
  const prefix = value.slice(0, index).match(/([A-Za-z_][A-Za-z0-9_$]*)\s*$/u)?.[1];
  return Boolean(prefix && COMPLETION_GENERIC_TYPE_NAMES.has(prefix.toLowerCase()));
}

export function sqlCompletionItemType(item: CompletionItem): SqlCompletionItemType {
  switch (item.kind) {
    case CompletionItemKind.Keyword:
      return "keyword";
    case CompletionItemKind.Class:
    case CompletionItemKind.Struct:
    case CompletionItemKind.File:
    case CompletionItemKind.Folder:
      return "table";
    case CompletionItemKind.Field:
      return "column";
    case CompletionItemKind.Snippet:
      return "snippet";
    case CompletionItemKind.Function:
    case CompletionItemKind.Method:
    case CompletionItemKind.Constructor:
      return "function";
    case CompletionItemKind.Module:
      return "schema";
    case CompletionItemKind.Variable:
      return "variable";
    case CompletionItemKind.Property:
      return "property";
    default:
      return "text";
  }
}

export function appendSqlCompletionSpace(
  insertText: string,
  options: {
    enabled: boolean;
    itemType: SqlCompletionItemType;
    nextCharacter?: string;
  },
) {
  if (
    !options.enabled ||
    options.itemType === "property" ||
    options.itemType === "text" ||
    options.itemType === "schema" ||
    options.itemType === "variable" ||
    options.itemType === "snippet" ||
    options.itemType === "function"
  ) {
    return insertText;
  }
  if (!insertText || /\s$/u.test(insertText) || insertText.endsWith(".")) {
    return insertText;
  }

  const nextCharacter = options.nextCharacter || "";
  if (
    /\s/u.test(nextCharacter) ||
    COMPLETION_SPACE_BLOCKING_CHARACTERS.has(nextCharacter)
  ) {
    return insertText;
  }
  return `${insertText} `;
}

/**
 * Some accepted completions deliberately end at the boundary of another
 * completion scope. Reopen suggestions after the edit instead of relying on
 * Monaco to treat programmatically inserted trigger characters as typing.
 */
export function shouldChainSqlCompletionAfterAccept(
  item: CompletionItem,
  insertText: string,
  driver?: string,
) {
  if (
    sqlCompletionItemType(item) === "schema" &&
    insertText.trimEnd().endsWith(".")
  ) {
    return true;
  }
  return (
    driver?.trim().toLocaleLowerCase() === "sqlserver" &&
    sqlCompletionItemType(item) === "keyword" &&
    item.label.trim().toLocaleUpperCase() === "USE"
  );
}

function signatureParameters(signature: string) {
  if (signature.length > MAX_COMPLETION_SIGNATURE_LENGTH) return null;
  const open = signature.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  let quote = "";
  for (let index = open; index < signature.length; index += 1) {
    const character = signature[index] || "";
    if (quote) {
      if (character === quote) {
        if (signature[index + 1] === quote) {
          index += 1;
        } else if (signature[index - 1] !== "\\") {
          quote = "";
        }
      }
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) return null;
  const source = signature.slice(open + 1, close).trim();
  if (!source || /^void$/iu.test(source)) return [];

  const parameters: string[] = [];
  let start = 0;
  depth = 0;
  let squareDepth = 0;
  let angleDepth = 0;
  quote = "";
  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index] || "";
    if (quote) {
      if (character === quote) {
        if (source[index + 1] === quote) {
          index += 1;
        } else if (source[index - 1] !== "\\") {
          quote = "";
        }
      }
      continue;
    }
    if (["'", '"', "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if (character === "[") squareDepth += 1;
    if (character === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (
      character === "<"
      && (angleDepth > 0 || opensCompletionGenericType(source, index))
    ) angleDepth += 1;
    if (character === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (
      (character === ","
        && depth === 0
        && squareDepth === 0
        && angleDepth === 0)
      || index === source.length
    ) {
      const parameter = source.slice(start, index).trim();
      if (parameter) parameters.push(parameter);
      if (parameters.length > MAX_COMPLETION_SIGNATURE_PARAMETERS) return null;
      start = index + 1;
    }
  }
  if (quote || depth > 0 || squareDepth > 0 || angleDepth > 0) return null;
  return parameters;
}

function snippetParameterLabel(parameter: string, index: number) {
  const withoutMode = parameter
    .replace(/^\s*(?:INOUT|IN|OUT|VARIADIC)\s+/iu, "")
    .replace(/\s*=.*$/u, "")
    .trim();
  const quotedName = withoutMode.match(/^"((?:""|[^"])*)"\s*/u)?.[1]
    ?.replace(/""/gu, '"')
    || withoutMode.match(/^`((?:``|[^`])*)`\s*/u)?.[1]?.replace(/``/gu, "`")
    || withoutMode.match(/^\[((?:\]\]|[^\]])*)\]\s*/u)?.[1]?.replace(/\]\]/gu, "]");
  const named = withoutMode.match(/^([A-Za-z_][A-Za-z0-9_$]*)\s*(?::|\s)/u)?.[1];
  return (quotedName || named || withoutMode || `arg${index + 1}`)
    .replace(/[\r\n\t]+/gu, " ")
    .replace(/[}$\\]/gu, "")
    .slice(0, 48);
}

/**
 * Some SQL language servers return a function signature but only insert its
 * bare name. Turn that narrow case into a Monaco snippet while keeping server
 * text edits and already-snippet-aware servers authoritative.
 */
export function sqlFunctionCompletionInsertion(
  item: CompletionItem,
  insertText: string,
  nextCharacter?: string,
) {
  if (
    sqlCompletionItemType(item) !== "function" ||
    item.textEdit ||
    item.insertTextFormat === 2 ||
    insertText.includes("(") ||
    nextCharacter === "("
  ) {
    return { insertText, insertAsSnippet: item.insertTextFormat === 2 };
  }

  const parameters = signatureParameters(item.detail || item.label);
  if (!parameters) return { insertText, insertAsSnippet: false };
  const fields = parameters.map(
    (parameter, index) =>
      `\${${index + 1}:${snippetParameterLabel(parameter, index)}}`,
  );
  return {
    insertText: `${insertText}(${fields.join(", ")})`,
    insertAsSnippet: fields.length > 0,
  };
}
