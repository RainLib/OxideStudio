import {
  completionFilterText,
  completionInsertText,
  completionSortText,
  toMonacoCompletionKind,
} from "@/lib/lspCompletion";
import {
  completionUsageScore,
  usageRankedCompletionSortText,
} from "@/lib/completionUsage";
import type { CompletionItem } from "@/services/lsp/types";
import { toMonacoRange } from "./lspMonacoAdapter";
import {
  appendSqlCompletionSpace,
  sqlCompletionItemType,
} from "./sqlCompletionInsertion";

export interface LspCompletionPresentationOptions {
  monaco: any;
  items: CompletionItem[];
  typedWord: string;
  completedContextKeyword: boolean;
  defaultRange: any;
  rankByUsage: boolean;
  usageScope: string;
  recordUsageCommand: string;
  appendSpace: boolean;
  nextCharacter?: string;
}

/**
 * Presents LSP completion items without owning request or editor lifecycle.
 * Server text edits remain authoritative; the caller only supplies the range
 * used when the server did not return one.
 */
export function lspCompletionItemsToMonacoSuggestions({
  monaco,
  items,
  typedWord,
  completedContextKeyword,
  defaultRange,
  rankByUsage,
  usageScope,
  recordUsageCommand,
  appendSpace,
  nextCharacter,
}: LspCompletionPresentationOptions) {
  return items.map((item) => ({
    label: item.label,
    kind: toMonacoCompletionKind(monaco, item.kind),
    detail: item.detail,
    documentation: item.documentation,
    insertText: appendSqlCompletionSpace(
      completionInsertText(item, completedContextKeyword),
      {
        enabled: appendSpace,
        itemType: sqlCompletionItemType(item),
        nextCharacter,
      },
    ),
    sortText: rankByUsage
      ? usageRankedCompletionSortText(
          completionSortText(item),
          completionUsageScore(usageScope, item.label),
        )
      : completionSortText(item),
    filterText: completionFilterText(
      item,
      typedWord,
      completedContextKeyword,
    ),
    preselect: item.preselect,
    command: rankByUsage
      ? {
          id: recordUsageCommand,
          title: "Record SQL completion usage",
          arguments: [usageScope, item.label],
        }
      : undefined,
    insertTextRules:
      item.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range: item.textEdit
      ? toMonacoRange(monaco, item.textEdit.range)
      : defaultRange,
  }));
}
