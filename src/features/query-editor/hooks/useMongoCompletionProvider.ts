import { mongodbJsonStringCompletionRange } from "@/features/query-editor/model/completionProviderRuntime";
import {
  buildMongoDbConsoleCompletions,
  MONGODB_COMPLETION_TRIGGER_CHARACTERS,
  MONGODB_CONSOLE_LANGUAGE_ID,
  mongodbCompletionUsesSnippetSyntax,
  mongodbConsoleCompletionContext,
} from "@/lib/mongodbCompletion";
import {
  documentMetadataCacheKey,
  knownDocumentCollectionNamesForScope,
  loadDocumentMetadata,
} from "@/services/documentMetadataCache";
import { extractLspDocumentIdentity } from "@/services/lsp";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { schemaService } from "@/services/tauri";
import { useEffect } from "react";

interface MongoCompletionProviderContext {
  isActivePane: boolean;
  monaco: typeof import("monaco-editor") | null;
  isMongoDbConsole: boolean;
  effectiveConnectionId: string | null;
  activeTab:
    | import("@/features/workspace-tabs/model/types").TabData
    | undefined;
  currentSchema: string | null;
  activeConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  activeProjectId: string;
  schemaCollections: import("@/services/tauri/types").CollectionInfo[];
  activeConnectionId: string | null;
  effectiveTabId: string | null;
  retriggerActiveDocumentCompletion: (request: {
    model: any;
    position: { lineNumber: number; column: number };
    modelVersion: number;
    token: { isCancellationRequested?: boolean | undefined };
  }) => void;
}

export function useMongoCompletionProvider({
  isActivePane,
  monaco,
  isMongoDbConsole,
  effectiveConnectionId,
  activeTab,
  currentSchema,
  activeConnection,
  activeProjectId,
  schemaCollections,
  activeConnectionId,
  effectiveTabId,
  retriggerActiveDocumentCompletion,
}: MongoCompletionProviderContext) {
  useEffect(() => {
    if (
      !isActivePane ||
      !monaco ||
      !isMongoDbConsole ||
      !effectiveConnectionId
    ) {
      return;
    }

    const collectionNamespace =
      activeTab?.targetSchema ||
      currentSchema ||
      activeConnection?.database ||
      "";
    const collectionCacheKey = documentMetadataCacheKey({
      projectId: activeProjectId || "local",
      connectionId: effectiveConnectionId,
      driver: "mongodb",
      namespace: collectionNamespace,
      kind: "collections",
    });
    const loadCollections = (onBackgroundRefresh?: () => void) => {
      const knownCollections = knownDocumentCollectionNamesForScope(
        schemaCollections,
        {
          metadataConnectionId: activeConnectionId,
          targetConnectionId: effectiveConnectionId,
          namespace: collectionNamespace,
        },
      );
      const request =
        knownCollections.length > 0
          ? Promise.resolve(knownCollections)
          : schemaService
              .getCollections(effectiveConnectionId, collectionNamespace)
              .then((collections) =>
                collections.map((collection) => collection.name),
              );
      return loadDocumentMetadata(
        collectionCacheKey,
        () =>
          request
            .then((collections) => [
              ...new Set(
                collections.map((name) => name.trim()).filter(Boolean),
              ),
            ])
            .catch((error) => {
              console.debug("[MongoDB Console] Collections unavailable", error);
              return [];
            }),
        { onBackgroundRefresh },
      );
    };
    const loadFields = (
      collection: string,
      onBackgroundRefresh?: () => void,
    ) => {
      const cacheKey = documentMetadataCacheKey({
        projectId: activeProjectId || "local",
        connectionId: effectiveConnectionId,
        driver: "mongodb",
        namespace: collectionNamespace,
        kind: "fields",
        objectName: collection,
      });
      return loadDocumentMetadata(
        cacheKey,
        () =>
          loadTableMetadata({
            projectId: activeProjectId || undefined,
            connectionId: effectiveConnectionId,
            driver: "mongodb",
            schema: collectionNamespace,
            table: collection,
            includeIndexes: false,
            includeConstraints: false,
          })
            .then((metadata) =>
              metadata.columns.map((column) => ({
                name: column.name,
                dataType: column.data_type || "field",
              })),
            )
            .catch((error) => {
              console.debug(
                `[MongoDB Console] Fields unavailable for ${collection}`,
                error,
              );
              return [];
            }),
        { onBackgroundRefresh },
      );
    };

    const disposable = monaco.languages.registerCompletionItemProvider(
      MONGODB_CONSOLE_LANGUAGE_ID,
      {
        triggerCharacters: MONGODB_COMPLETION_TRIGGER_CHARACTERS,
        provideCompletionItems: async (
          model: any,
          position: any,
          _providerContext: any,
          token: { isCancellationRequested?: boolean },
        ) => {
          const identity = extractLspDocumentIdentity(model.uri.toString());
          if (
            identity?.tabId !== effectiveTabId ||
            identity.driver !== "mongodb"
          ) {
            return { suggestions: [] };
          }
          const source = model.getValue();
          const offset = model.getOffsetAt(position);
          const initialVersion = model.getVersionId();
          const context = mongodbConsoleCompletionContext(source, offset);
          const needsCollections =
            context.area === "collection" || context.area === "shell-qualified";
          const needsFields =
            context.area === "field" || context.area === "field-reference";
          let refreshQueued = false;
          const onBackgroundRefresh = () => {
            if (refreshQueued) return;
            refreshQueued = true;
            retriggerActiveDocumentCompletion({
              model,
              position,
              modelVersion: initialVersion,
              token,
            });
          };
          const [collections, fields] = await Promise.all([
            needsCollections
              ? loadCollections(onBackgroundRefresh)
              : Promise.resolve([]),
            needsFields && context.collection
              ? loadFields(context.collection, onBackgroundRefresh)
              : Promise.resolve([]),
          ]);
          if (
            token?.isCancellationRequested ||
            model.getVersionId() !== initialVersion
          ) {
            return { suggestions: [] };
          }
          const { items } = buildMongoDbConsoleCompletions(source, offset, {
            collections,
            fields,
          });
          const range =
            context.syntax === "shell"
              ? new monaco.Range(
                  position.lineNumber,
                  Math.max(
                    1,
                    position.column -
                      (context.replacementLength ?? context.typed.length),
                  ),
                  position.lineNumber,
                  position.column,
                )
              : mongodbJsonStringCompletionRange(monaco, model, position);
          const kindMap = {
            property: monaco.languages.CompletionItemKind.Property,
            field: monaco.languages.CompletionItemKind.Field,
            operator: monaco.languages.CompletionItemKind.Operator,
            snippet: monaco.languages.CompletionItemKind.Snippet,
            value: monaco.languages.CompletionItemKind.Value,
          };
          return {
            incomplete: Boolean(needsCollections || needsFields),
            suggestions: items.map((item, index) => ({
              label: item.label,
              kind: kindMap[item.kind],
              detail: item.detail,
              documentation: item.documentation
                ? { value: item.documentation }
                : undefined,
              insertText: item.insertText,
              insertTextRules: mongodbCompletionUsesSnippetSyntax(item)
                ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              filterText: item.filterText || item.label,
              sortText: item.sortText || String(index).padStart(3, "0"),
              range,
            })),
          };
        },
      },
    );
    return () => disposable.dispose();
  }, [
    activeConnection?.database,
    activeConnectionId,
    activeProjectId,
    activeTab?.targetSchema,
    currentSchema,
    effectiveConnectionId,
    effectiveTabId,
    isActivePane,
    isMongoDbConsole,
    monaco,
    retriggerActiveDocumentCompletion,
    schemaCollections,
  ]);
}
