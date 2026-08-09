import { CompletionItemKind, type CompletionItem } from "@/services/lsp/types";

export type SqlCompletionItemType =
  | "keyword"
  | "table"
  | "column"
  | "snippet"
  | "function"
  | "schema"
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

function signatureParameters(signature: string) {
  const open = signature.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let index = open; index < signature.length; index += 1) {
    const character = signature[index];
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
  for (let index = 0; index <= source.length; index += 1) {
    const character = source[index];
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if ((character === "," && depth === 0) || index === source.length) {
      const parameter = source.slice(start, index).trim();
      if (parameter) parameters.push(parameter);
      start = index + 1;
    }
  }
  return parameters;
}

function snippetParameterLabel(parameter: string, index: number) {
  const withoutMode = parameter
    .replace(/^\s*(?:INOUT|IN|OUT|VARIADIC)\s+/iu, "")
    .replace(/\s*=.*$/u, "")
    .trim();
  const named = withoutMode.match(/^([A-Za-z_][A-Za-z0-9_$]*)\s*(?::|\s)/u)?.[1];
  return (named || withoutMode || `arg${index + 1}`)
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
