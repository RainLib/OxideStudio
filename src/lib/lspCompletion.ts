import {
  CompletionItemKind,
  type CompletionContext,
  type CompletionItem,
} from "@/services/lsp/types";
import { completionFilterTextForQuery } from "@/features/query-editor/model/completionMatch";
import { cachedIdentifierFragment, cachedIdentifierQualifier } from "@/features/query-editor/model/cached-completion/identifierFragments";

const SQL_CONTEXT_KEYWORDS = new Set([
  "select",
  "distinct",
  "all",
  "and",
  "or",
  "returning",
  "from",
  "join",
  "where",
  "on",
  "by",
  "having",
  "limit",
  "offset",
  "values",
  "set",
  "into",
  "update",
  "table",
  "truncate",
  "describe",
  "desc",
]);

export function isCompletedSqlContextKeyword(word: string) {
  return SQL_CONTEXT_KEYWORDS.has(word.trim().toLowerCase());
}

export function sqlContextKeywordBeforeCursor(textBeforeCursor: string) {
  const trimmed = textBeforeCursor.trimEnd();
  const fragment = cachedIdentifierFragment(trimmed);
  if (fragment.openingQuote || fragment.unsupported || cachedIdentifierQualifier(trimmed)) return null;
  const token = fragment.prefix;
  if (!token) return null;

  const keyword = token.toLowerCase();
  return SQL_CONTEXT_KEYWORDS.has(keyword) ? keyword : null;
}

function isRelationCompletionKind(kind?: number) {
  return (
    kind === CompletionItemKind.Class ||
    kind === CompletionItemKind.Struct ||
    kind === CompletionItemKind.Module ||
    kind === CompletionItemKind.File ||
    kind === CompletionItemKind.Folder
  );
}

export function filterCompletionsForSqlContext(
  items: CompletionItem[],
  contextKeyword: string | null
) {
  if (!contextKeyword) return items;

  return items.filter((item) => {
    const label = item.label.trim().toLowerCase();
    if (label === contextKeyword) return false;

    switch (contextKeyword) {
      case "from":
      case "join":
      case "into":
      case "update":
      case "table":
      case "truncate":
      case "describe":
      case "desc":
        return isRelationCompletionKind(item.kind);
      case "where":
      case "on":
      case "having":
      case "and":
      case "or":
        return (
          !isRelationCompletionKind(item.kind) &&
          item.kind !== CompletionItemKind.Operator
        );
      case "select":
      case "distinct":
      case "all":
      case "returning":
      case "by":
      case "values":
      case "set":
        return (
          !isRelationCompletionKind(item.kind) &&
          item.kind !== CompletionItemKind.Operator
        );
      default:
        return true;
    }
  });
}

export function completionInsertText(
  item: CompletionItem,
  completedContextKeyword: boolean
) {
  if (item.textEdit) return item.textEdit.newText;

  const insertText = item.insertText || item.label;
  return completedContextKeyword ? ` ${insertText}` : insertText;
}

export function completionFilterText(
  item: CompletionItem,
  typedWord: string,
  completedContextKeyword: boolean
) {
  const existing =
    item.filterText || (completedContextKeyword ? typedWord : undefined);
  if (typedWord) {
    return completionFilterTextForQuery(item.label, typedWord, existing);
  }
  if (item.filterText) return item.filterText;
  return completedContextKeyword ? typedWord : undefined;
}

export function completionSortText(item: CompletionItem) {
  if (item.sortText) return item.sortText;

  const label = item.label.toLowerCase();
  switch (item.kind) {
    case CompletionItemKind.Field:
    case CompletionItemKind.Property:
    case CompletionItemKind.Class:
      return `0:${label}`;
    case CompletionItemKind.Function:
    case CompletionItemKind.Method:
      return `1:${label}`;
    case CompletionItemKind.Operator:
      return `2:${label}`;
    case CompletionItemKind.Keyword:
      return `3:${label}`;
    default:
      return `4:${label}`;
  }
}

export function toLspCompletionContext(monacoContext?: {
  triggerKind?: number;
  triggerCharacter?: string;
}): CompletionContext {
  const triggerKind: CompletionContext["triggerKind"] =
    monacoContext?.triggerKind === 1
      ? 2
      : monacoContext?.triggerKind === 2
        ? 3
        : 1;

  return {
    triggerKind,
    ...(monacoContext?.triggerCharacter
      ? { triggerCharacter: monacoContext.triggerCharacter }
      : {}),
  };
}

export function toMonacoCompletionKind(monaco: any, lspKind?: number) {
  switch (lspKind) {
    case CompletionItemKind.Method:
      return monaco.languages.CompletionItemKind.Method;
    case CompletionItemKind.Function:
      return monaco.languages.CompletionItemKind.Function;
    case CompletionItemKind.Constructor:
      return monaco.languages.CompletionItemKind.Constructor;
    case CompletionItemKind.Field:
      return monaco.languages.CompletionItemKind.Field;
    case CompletionItemKind.Variable:
      return monaco.languages.CompletionItemKind.Variable;
    case CompletionItemKind.Class:
      return monaco.languages.CompletionItemKind.Class;
    case CompletionItemKind.Interface:
      return monaco.languages.CompletionItemKind.Interface;
    case CompletionItemKind.Module:
      return monaco.languages.CompletionItemKind.Module;
    case CompletionItemKind.Property:
      return monaco.languages.CompletionItemKind.Property;
    case CompletionItemKind.Unit:
      return monaco.languages.CompletionItemKind.Unit;
    case CompletionItemKind.Value:
      return monaco.languages.CompletionItemKind.Value;
    case CompletionItemKind.Enum:
      return monaco.languages.CompletionItemKind.Enum;
    case CompletionItemKind.Keyword:
      return monaco.languages.CompletionItemKind.Keyword;
    case CompletionItemKind.Snippet:
      return monaco.languages.CompletionItemKind.Snippet;
    case CompletionItemKind.Color:
      return monaco.languages.CompletionItemKind.Color;
    case CompletionItemKind.File:
      return monaco.languages.CompletionItemKind.File;
    case CompletionItemKind.Reference:
      return monaco.languages.CompletionItemKind.Reference;
    case CompletionItemKind.Folder:
      return monaco.languages.CompletionItemKind.Folder;
    case CompletionItemKind.EnumMember:
      return monaco.languages.CompletionItemKind.EnumMember;
    case CompletionItemKind.Constant:
      return monaco.languages.CompletionItemKind.Constant;
    case CompletionItemKind.Struct:
      return monaco.languages.CompletionItemKind.Struct;
    case CompletionItemKind.Event:
      return monaco.languages.CompletionItemKind.Event;
    case CompletionItemKind.Operator:
      return monaco.languages.CompletionItemKind.Operator;
    case CompletionItemKind.TypeParameter:
      return monaco.languages.CompletionItemKind.TypeParameter;
    case CompletionItemKind.Text:
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}
