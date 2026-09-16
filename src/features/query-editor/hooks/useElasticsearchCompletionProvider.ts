import {
  elasticsearchJsonStringCompletionRange,
  elasticsearchPathCompletionRange,
} from "@/features/query-editor/model/elasticsearchCompletionRange";
import { syncLspModelBeforeCompletion } from "@/features/query-editor/model/lspDocumentSync";
import {
  ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
  ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
  elasticsearchCompletionExpectsMappingField,
  elasticsearchConsoleCompletionContext,
  elasticsearchConsoleRequestContext,
  elasticsearchMappingFieldCompletions,
  elasticsearchSchemaCompletionsForContext,
} from "@/lib/elasticsearchConsole";
import { toLspCompletionContext } from "@/lib/lspCompletion";
import {
  documentMetadataCacheKey,
  loadDocumentMetadata,
} from "@/services/documentMetadataCache";
import { extractLspDocumentIdentity } from "@/services/lsp";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { schemaService } from "@/services/tauri";
import { useEffect } from "react";

interface ElasticsearchCompletionProviderContext {
  isActivePane: boolean;
  monaco: typeof import("monaco-editor") | null;
  isElasticsearchConsole: boolean;
  effectiveConnectionId: string | null;
  effectiveTabId: string | null;
  preferredElasticsearchIndex: string | undefined;
  retriggerActiveDocumentCompletion: (request: {
    model: any;
    position: { lineNumber: number; column: number };
    modelVersion: number;
    token: { isCancellationRequested?: boolean | undefined };
  }) => void;
  activeProjectId: string;
  elasticsearchMetadataNamespace: string;
  lspReady: boolean;
  canUseLsp: boolean;
  documentLanguageId: string;
  lspClient: import("@/services/lsp/client").LspClient;
  openedDocumentsRef: React.RefObject<Set<string>>;
  documentVersionsRef: React.RefObject<Map<string, number>>;
  documentTextsRef: React.RefObject<Map<string, string>>;
  documentUri: string;
}

export function useElasticsearchCompletionProvider({
  isActivePane,
  monaco,
  isElasticsearchConsole,
  effectiveConnectionId,
  effectiveTabId,
  preferredElasticsearchIndex,
  retriggerActiveDocumentCompletion,
  activeProjectId,
  elasticsearchMetadataNamespace,
  lspReady,
  canUseLsp,
  documentLanguageId,
  lspClient,
  openedDocumentsRef,
  documentVersionsRef,
  documentTextsRef,
  documentUri,
}: ElasticsearchCompletionProviderContext) {
  useEffect(() => {
    if (
      !isActivePane ||
      !monaco ||
      !isElasticsearchConsole ||
      !effectiveConnectionId
    ) {
      return;
    }

    const disposable = monaco.languages.registerCompletionItemProvider(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        triggerCharacters: ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
        provideCompletionItems: async (
          model: any,
          position: any,
          providerContext: any,
          token: { isCancellationRequested?: boolean },
        ) => {
          const identity = extractLspDocumentIdentity(model.uri.toString());
          if (
            identity?.tabId !== effectiveTabId ||
            (identity.driver !== "elasticsearch" &&
              identity.driver !== "elastic")
          ) {
            return { suggestions: [] };
          }

          const source = model.getValue();
          const offset = model.getOffsetAt(position);
          const completionContext = elasticsearchConsoleCompletionContext(
            source,
            offset,
          );
          const expectsMappingField =
            elasticsearchCompletionExpectsMappingField(completionContext);
          const isIndexPath = completionContext.area === "path";
          if (!expectsMappingField && !isIndexPath) {
            return { suggestions: [] };
          }

          const requestContext = elasticsearchConsoleRequestContext(
            source,
            offset,
            preferredElasticsearchIndex,
          );
          const indexName = requestContext.index?.trim();
          if (expectsMappingField && !indexName) {
            return { suggestions: [] };
          }

          const modelVersion = model.getVersionId();
          let refreshQueued = false;
          const onBackgroundRefresh = () => {
            if (refreshQueued) return;
            refreshQueued = true;
            retriggerActiveDocumentCompletion({
              model,
              position,
              modelVersion,
              token,
            });
          };
          let fieldCompletions: Array<{
            label: string;
            detail?: string;
            insertText?: string;
            sortText?: string;
          }> = [];
          if (isIndexPath) {
            const cacheKey = documentMetadataCacheKey({
              projectId: activeProjectId || "local",
              connectionId: effectiveConnectionId,
              driver: "elasticsearch",
              namespace: elasticsearchMetadataNamespace,
              kind: "collections",
            });
            const collections = await loadDocumentMetadata(
              cacheKey,
              () =>
                schemaService
                  .getCollections(
                    effectiveConnectionId,
                    elasticsearchMetadataNamespace,
                  )
                  .then((collections) =>
                    collections
                      .map((collection) => ({
                        name: collection.name.trim(),
                        type: collection.type || "index",
                      }))
                      .filter((collection) => Boolean(collection.name)),
                  )
                  .catch((error) => {
                    console.debug(
                      "[Elasticsearch Console] Indices unavailable",
                      error,
                    );
                    return [];
                  }),
              { onBackgroundRefresh },
            );
            fieldCompletions = elasticsearchSchemaCompletionsForContext(
              collections.map((collection) => ({
                label: collection.name,
                detail: `Elasticsearch ${collection.type}: ${collection.name}`,
                insertText: collection.name,
              })),
              completionContext,
              preferredElasticsearchIndex,
            );
          } else {
            const cacheKey = documentMetadataCacheKey({
              projectId: activeProjectId || "local",
              connectionId: effectiveConnectionId,
              driver: "elasticsearch",
              namespace: elasticsearchMetadataNamespace,
              kind: "fields",
              objectName: indexName!,
            });
            const fields = await loadDocumentMetadata(
              cacheKey,
              async () => {
                try {
                  const metadataOptions = {
                    projectId: activeProjectId || undefined,
                    connectionId: effectiveConnectionId,
                    driver: "elasticsearch" as const,
                    schema: elasticsearchMetadataNamespace,
                    table: indexName!,
                    includeIndexes: false,
                    includeConstraints: false,
                  };
                  let metadata = await loadTableMetadata(metadataOptions);
                  // A previous offline catalog sync may have persisted an empty
                  // placeholder. Refresh that one object once instead of treating
                  // the placeholder as an authoritative mapping forever.
                  if (metadata.columns.length === 0) {
                    metadata = await loadTableMetadata({
                      ...metadataOptions,
                      force: true,
                    });
                  }
                  return metadata.columns.map((column) => ({
                    name: column.name,
                    dataType: column.data_type || "field",
                  }));
                } catch (error) {
                  console.debug(
                    `[Elasticsearch Console] Mapping fields unavailable for ${indexName}`,
                    error,
                  );
                  return [];
                }
              },
              { onBackgroundRefresh },
            );
            fieldCompletions = elasticsearchMappingFieldCompletions(
              fields,
              completionContext,
              indexName!,
            );
          }

          if (
            token?.isCancellationRequested ||
            model.getVersionId() !== modelVersion
          ) {
            return { suggestions: [] };
          }

          const range = isIndexPath
            ? elasticsearchPathCompletionRange(monaco, model, position)
            : elasticsearchJsonStringCompletionRange(monaco, model, position);
          // Keep the already-synchronized LSP catalog as a fallback when live
          // index/mapping metadata is unavailable (for example during a brief
          // reconnect). This provider owns Console path and field positions,
          // so results do not race a second provider with a stale catalog.
          if (fieldCompletions.length === 0 && lspReady && canUseLsp) {
            try {
              const uri = model.uri.toString();
              await syncLspModelBeforeCompletion({
                uri,
                model,
                languageId: documentLanguageId,
                client: lspClient,
                openedDocuments: openedDocumentsRef.current,
                documentVersions: documentVersionsRef.current,
                documentTexts: documentTextsRef.current,
              });
              const items = await lspClient.getCompletions(
                uri,
                position.lineNumber - 1,
                position.column - 1,
                toLspCompletionContext(providerContext),
              );
              fieldCompletions = elasticsearchSchemaCompletionsForContext(
                items,
                completionContext,
                indexName,
              );
            } catch (error) {
              console.debug(
                `[Elasticsearch Console] LSP mapping fallback unavailable for ${indexName}`,
                error,
              );
            }
          }

          if (
            token?.isCancellationRequested ||
            model.getVersionId() !== modelVersion
          ) {
            return { suggestions: [] };
          }

          const suggestions = fieldCompletions.map((field) => ({
            label: field.label,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: field.detail,
            insertText: field.insertText || JSON.stringify(field.label),
            filterText: field.label,
            sortText: field.sortText,
            range,
          }));

          return { incomplete: false, suggestions };
        },
      },
    );
    return () => disposable.dispose();
  }, [
    activeProjectId,
    documentUri,
    effectiveConnectionId,
    effectiveTabId,
    elasticsearchMetadataNamespace,
    canUseLsp,
    documentLanguageId,
    isActivePane,
    isElasticsearchConsole,
    lspClient,
    lspReady,
    monaco,
    preferredElasticsearchIndex,
    retriggerActiveDocumentCompletion,
  ]);
}
