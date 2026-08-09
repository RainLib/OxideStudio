import { useEffect } from "react";
import {
  ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
  shouldOfferElasticsearchCompletions,
  shouldTriggerElasticsearchCompletions,
} from "@/lib/elasticsearchConsole";
import {
  shouldOfferMongoDbCompletions,
  shouldTriggerMongoDbCompletions,
} from "@/lib/mongodbCompletion";
import { extractLspDocumentIdentity } from "@/services/lsp";

type Disposable = { dispose: () => void };

export type ConsoleAutoSuggestOptions = {
  delayMs?: number;
  editor: any;
};

export type UseConsoleAutoSuggestOptions = ConsoleAutoSuggestOptions & {
  ownerKey: string;
};

/** Owns bounded Console completion triggering and its model/focus/version gates. */
export function useConsoleAutoSuggest(options: UseConsoleAutoSuggestOptions) {
  useEffect(() => {
    if (!options.editor || !options.ownerKey) return;
    return attachConsoleAutoSuggest(options).dispose;
  }, [options.delayMs, options.editor, options.ownerKey]);
}

export function attachConsoleAutoSuggest(
  options: ConsoleAutoSuggestOptions,
): Disposable {
  const { delayMs = 45, editor } = options;
  let timer: number | null = null;
  let disposed = false;

  const schedule = (
    model: any,
    insertedText: string,
    allowDeletion: boolean,
  ) => {
    if (!editor.hasTextFocus()) return;
    const identity = extractLspDocumentIdentity(model.uri.toString());
    const isElasticsearchModel =
      model.getLanguageId() === ELASTICSEARCH_CONSOLE_LANGUAGE_ID;
    const isMongoDbModel =
      model.getLanguageId() === "json" && identity?.driver === "mongodb";
    if (!isElasticsearchModel && !isMongoDbModel) return;
    const position = editor.getPosition();
    if (!position) return;
    const offset = model.getOffsetAt(position);
    const source = model.getValue();
    const shouldTrigger = isElasticsearchModel
      ? shouldTriggerElasticsearchCompletions(source, offset, insertedText)
      : shouldTriggerMongoDbCompletions(source, offset, insertedText);
    const shouldOfferAfterDeletion = isElasticsearchModel
      ? shouldOfferElasticsearchCompletions(source, offset)
      : shouldOfferMongoDbCompletions(source, offset);
    if (!shouldTrigger && !(allowDeletion && shouldOfferAfterDeletion)) return;

    if (timer !== null) window.clearTimeout(timer);
    const version = model.getVersionId();
    timer = window.setTimeout(() => {
      timer = null;
      if (
        disposed ||
        editor.getModel() !== model ||
        model.getVersionId() !== version ||
        !editor.hasTextFocus()
      ) {
        return;
      }
      editor.trigger(
        isElasticsearchModel
          ? "oxide.elasticsearch.autoSuggest"
          : "oxide.mongodb.autoSuggest",
        "editor.action.triggerSuggest",
        {},
      );
    }, delayMs);
  };

  const contentDisposable = editor.onDidChangeModelContent(
    (event: { changes?: Array<{ text?: string; rangeLength?: number }> }) => {
      const model = editor.getModel();
      if (!model) return;
      const changes = event.changes || [];
      const insertedText = changes.map((change) => change.text || "").join("");
      const deletedText = changes.some((change) => (change.rangeLength || 0) > 0);
      schedule(model, insertedText, deletedText && !insertedText);
    },
  );

  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      contentDisposable.dispose();
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    },
  };
}
