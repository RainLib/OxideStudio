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
import {
  lspDocumentationForMonaco,
  toMonacoRange,
} from "./lspMonacoAdapter";
import {
  appendSqlCompletionSpace,
  sqlFunctionCompletionInsertion,
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
  return items.map((item) => {
    const spacedInsertText = appendSqlCompletionSpace(
      completionInsertText(item, completedContextKeyword),
      {
        enabled: appendSpace,
        itemType: sqlCompletionItemType(item),
        nextCharacter,
      },
    );
    const functionInsertion = sqlFunctionCompletionInsertion(
      item,
      spacedInsertText,
      nextCharacter,
    );
    return {
      label: item.label,
      kind: toMonacoCompletionKind(monaco, item.kind),
      detail: item.detail,
      documentation: lspDocumentationForMonaco(item.documentation),
      insertText: functionInsertion.insertText,
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
      tags: item.deprecated
        ? [monaco.languages.CompletionItemTag.Deprecated]
        : undefined,
      commitCharacters: item.commitCharacters,
      additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
        range: toMonacoRange(monaco, edit.range),
        text: edit.newText,
      })),
      command: rankByUsage
        ? {
            id: recordUsageCommand,
            title: "Record SQL completion usage",
            arguments: [usageScope, item.label],
          }
        : undefined,
      insertTextRules: functionInsertion.insertAsSnippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      range: item.textEdit
        ? toMonacoRange(monaco, item.textEdit.range)
        : defaultRange,
    };
  });
}
