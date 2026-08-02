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
