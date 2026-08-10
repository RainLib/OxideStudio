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
  shouldChainSqlCompletionAfterAccept,
  sqlFunctionCompletionInsertion,
  sqlCompletionItemType,
} from "./sqlCompletionInsertion";

export interface LspCompletionPresentationOptions {
  monaco: any;
  ownerKey: string;
  items: CompletionItem[];
  typedWord: string;
  completedContextKeyword: boolean;
  defaultRange: any;
  rankByUsage: boolean;
  usageScope: string;
  recordUsageCommand: string;
  appendSpace: boolean;
  driver?: string;
  nextCharacter?: string;
  /** The document revision that produced these lazy-resolvable candidates. */
  requestUri?: string;
  requestModelVersion?: number;
}

const LSP_COMPLETION_ITEM_PROPERTY = "__oxideLspCompletionItem";
const LSP_COMPLETION_RESOLVE_SOURCE = Symbol("oxideLspCompletionResolveSource");
const LSP_COMPLETION_RESOLVE_CONTEXT = Symbol("oxideLspCompletionResolveContext");

type LspBackedMonacoSuggestion = {
  [LSP_COMPLETION_ITEM_PROPERTY]?: CompletionItem;
};

type ResolvableLspCompletionItem = CompletionItem & {
  [LSP_COMPLETION_RESOLVE_SOURCE]?: CompletionItem;
};

export type LspCompletionResolveContext = {
  uri: string;
  modelVersion: number;
};

type LspBackedMonacoSuggestionWithContext = LspBackedMonacoSuggestion & {
  [LSP_COMPLETION_RESOLVE_CONTEXT]?: LspCompletionResolveContext;
};

/**
 * Keep the exact server item attached while context filters adapt a candidate.
 * Symbol properties survive object spreads but never leak into JSON payloads.
 */
export function markResolvableLspCompletionItems(
  items: CompletionItem[],
  enabled: boolean,
): CompletionItem[] {
  if (!enabled) return items;
  return items.map((item) => ({
    ...item,
    [LSP_COMPLETION_RESOLVE_SOURCE]: item,
  }));
}

export function sourceLspCompletionItem(
  suggestion: LspBackedMonacoSuggestion,
) {
  return suggestion[LSP_COMPLETION_ITEM_PROPERTY];
}

/** Resolves are rejected when their original document revision is no longer live. */
export function completionResolveRequestContext(
  suggestion: LspBackedMonacoSuggestionWithContext,
) {
  return suggestion[LSP_COMPLETION_RESOLVE_CONTEXT];
}

/**
 * LSP resolve may enrich only lazy presentation fields. The insertion/ranking
 * contract already shown by Monaco remains unchanged, including Oxide's usage
 * command and the range calculated for the original document revision.
 */
export function applyResolvedLspCompletionItem(
  monaco: any,
  suggestion: LspBackedMonacoSuggestion & Record<string, any>,
  item: CompletionItem,
) {
  return {
    ...suggestion,
    detail: item.detail ?? suggestion.detail,
    documentation:
      item.documentation === undefined
        ? suggestion.documentation
        : lspDocumentationForMonaco(item.documentation),
    additionalTextEdits:
      item.additionalTextEdits === undefined
        ? suggestion.additionalTextEdits
        : item.additionalTextEdits.map((edit) => ({
            range: toMonacoRange(monaco, edit.range),
            text: edit.newText,
          })),
    [LSP_COMPLETION_ITEM_PROPERTY]: item,
  };
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
  ownerKey,
  items,
  typedWord,
  completedContextKeyword,
  defaultRange,
  rankByUsage,
  usageScope,
  recordUsageCommand,
  appendSpace,
  driver,
  nextCharacter,
  requestUri,
  requestModelVersion,
}: LspCompletionPresentationOptions) {
  return items.map((item) => {
    const resolveSource = (item as ResolvableLspCompletionItem)[
      LSP_COMPLETION_RESOLVE_SOURCE
    ];
    const serverInsertText = completionInsertText(
      item,
      completedContextKeyword,
    );
    // A server textEdit is an authoritative edit contract. Client whitespace
    // preferences only apply to plain insertText/label proposals.
    const spacedInsertText = item.textEdit
      ? serverInsertText
      : appendSqlCompletionSpace(serverInsertText, {
          enabled: appendSpace,
          itemType: sqlCompletionItemType(item),
          nextCharacter,
        });
    const functionInsertion = sqlFunctionCompletionInsertion(
      item,
      spacedInsertText,
      nextCharacter,
    );
    const chainCompletion = shouldChainSqlCompletionAfterAccept(
      item,
      functionInsertion.insertText,
      driver,
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
      command: rankByUsage || chainCompletion
        ? {
            id: recordUsageCommand,
            title: chainCompletion
              ? "Continue SQL completion"
              : "Record SQL completion usage",
            arguments: [usageScope, item.label, chainCompletion, ownerKey],
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
      ...(resolveSource
        ? { [LSP_COMPLETION_ITEM_PROPERTY]: resolveSource }
        : {}),
      ...(resolveSource && requestUri && requestModelVersion !== undefined
        ? {
            [LSP_COMPLETION_RESOLVE_CONTEXT]: {
              uri: requestUri,
              modelVersion: requestModelVersion,
            },
          }
        : {}),
    };
  });
}
