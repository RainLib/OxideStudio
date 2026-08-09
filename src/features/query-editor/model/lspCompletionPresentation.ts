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
  toMonacoCompletionRange,
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

export function completionLabelForMonaco(item: CompletionItem) {
  return item.labelDetails?.detail || item.labelDetails?.description
    ? {
        label: item.label,
        detail: item.labelDetails.detail,
        description: item.labelDetails.description,
      }
    : item.label;
}

function completionInsertTextRules(
  monaco: any,
  item: CompletionItem,
  insertAsSnippet: boolean,
) {
  let rules = monaco.languages.CompletionItemInsertTextRule.None;
  if (insertAsSnippet) {
    rules |= monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  }
  if (item.insertTextMode === 1) {
    rules |= monaco.languages.CompletionItemInsertTextRule.KeepWhitespace;
  }
  return rules === monaco.languages.CompletionItemInsertTextRule.None
    ? undefined
    : rules;
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
      label: completionLabelForMonaco(item),
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
      insertTextRules: completionInsertTextRules(
        monaco,
        item,
        functionInsertion.insertAsSnippet,
      ),
      range: item.textEdit
        ? toMonacoCompletionRange(monaco, item.textEdit)
        : defaultRange,
    };
  });
}
