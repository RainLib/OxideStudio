import { useEffect, useRef, type MutableRefObject } from "react";
import type { LspClient } from "@/services/lsp";
import { extractLspDocumentIdentity } from "@/services/lsp";
import type { TableInfo } from "@/services/tauri";
import { lspLanguageId } from "@/lib/databaseDialect";
import {
  buildQueryEditorTableHoverMarkdown,
  findQueryEditorHoverTable,
  isSqlRelationIdentifierContext,
  sqlIdentifierAtColumn,
} from "@/lib/queryEditorTableHover";
import {
  loadTableDdl,
  loadTableMetadata,
} from "@/services/tableMetadataCache";
import { syncLspModelBeforeCompletion } from "../model/lspDocumentSync";
import { toMonacoRange } from "../model/lspMonacoAdapter";
import { useTableDdlHoverSearchWidget } from "./useTableDdlHoverSearchWidget";

type Disposable = { dispose: () => void };

export type LspHoverProviderRuntime = {
  activeProjectId?: string | null;
  canUseLsp: boolean;
  currentSchema?: string | null;
  databaseName?: string | null;
  documentLanguageId: string;
  documentUri: string;
  driver: Parameters<typeof loadTableMetadata>[0]["driver"];
  effectiveConnectionId?: string | null;
  metadataRevision?: number | null;
  openedDocumentsRef: MutableRefObject<Set<string>>;
  documentVersionsRef: MutableRefObject<Map<string, number>>;
  documentTextsRef: MutableRefObject<Map<string, string>>;
  schemaTables: TableInfo[];
  showTableDdlHoverPreview: boolean;
  supportsTableBrowsing: boolean;
  targetSchema?: string | null;
  interactiveTableHover?: boolean;
};

export type LspHoverProviderCoordinatorOptions = LspHoverProviderRuntime & {
  editorLanguageId: string;
  isActivePane: boolean;
  editor?: any;
  lspClient: LspClient;
  monaco: any;
};

function runtimeOwnerKey(runtime: LspHoverProviderRuntime) {
  return [
    runtime.documentUri,
    runtime.activeProjectId || "local",
    runtime.effectiveConnectionId || "",
    runtime.driver,
    runtime.databaseName || "",
    runtime.targetSchema || runtime.currentSchema || "",
    runtime.documentLanguageId,
    runtime.showTableDdlHoverPreview ? "ddl" : "metadata-only",
    runtime.metadataRevision ?? "",
  ].join("\u0000");
}

export function registerLspHoverProvider(options: {
  editorLanguageId: string;
  getRuntime: () => LspHoverProviderRuntime;
  lspClient: LspClient;
  monaco: any;
}): Disposable {
  const { editorLanguageId, getRuntime, lspClient, monaco } = options;
  return monaco.languages.registerHoverProvider(editorLanguageId, {
    provideHover: async (model: any, position: any) => {
      const runtime = getRuntime();
      const uri = model.uri.toString();
      if (!runtime.canUseLsp || uri !== runtime.documentUri) return null;

      const ownerKey = runtimeOwnerKey(runtime);
      const modelVersion = model.getVersionId();
      const isCurrentRequest = () => {
        const currentRuntime = getRuntime();
        return (
          currentRuntime.canUseLsp &&
          currentRuntime.documentUri === uri &&
          runtimeOwnerKey(currentRuntime) === ownerKey &&
          model.getVersionId() === modelVersion
        );
      };

      try {
        const identity = extractLspDocumentIdentity(uri);
        await syncLspModelBeforeCompletion({
          uri,
          model,
          languageId:
            identity?.driver?.toLowerCase() === runtime.driver.toLowerCase()
              ? runtime.documentLanguageId
              : identity?.driver
                ? lspLanguageId(identity.driver)
                : "sql",
          client: lspClient,
          openedDocuments: runtime.openedDocumentsRef.current,
          documentVersions: runtime.documentVersionsRef.current,
          documentTexts: runtime.documentTextsRef.current,
        });
      } catch {
        // Keep server and metadata hover independently available during a
        // transient document-sync failure.
      }
      if (!isCurrentRequest()) return null;

      const line = model.getLineContent(position.lineNumber);
      const identifier = sqlIdentifierAtColumn(line, position.column);
      const relation =
        runtime.effectiveConnectionId &&
        runtime.supportsTableBrowsing &&
        isSqlRelationIdentifierContext(line, position.column)
          ? findQueryEditorHoverTable(runtime.schemaTables, identifier)
          : null;
      const hoverSchema = runtime.targetSchema || runtime.currentSchema;
      const tableIdentity =
        relation && hoverSchema && runtime.effectiveConnectionId
          ? {
              projectId: runtime.activeProjectId || undefined,
              connectionId: runtime.effectiveConnectionId,
              driver: runtime.driver,
              databaseName: runtime.databaseName || undefined,
              schema: hoverSchema,
              table: relation.name,
            }
          : null;
      const interactiveTablePreview = Boolean(
        tableIdentity && runtime.interactiveTableHover,
      );
      const shouldLoadTablePreview = tableIdentity && !interactiveTablePreview;
      const [lspHover, metadata, ddl] = await Promise.all([
        interactiveTablePreview
          ? Promise.resolve(null)
          : lspClient
              .getHover(uri, position.lineNumber - 1, position.column - 1)
              .catch(() => null),
        shouldLoadTablePreview
          ? loadTableMetadata({
              ...tableIdentity,
              includeIndexes: true,
              includeConstraints: false,
            }).catch(() => null)
          : Promise.resolve(null),
        shouldLoadTablePreview && runtime.showTableDdlHoverPreview
          ? loadTableDdl(tableIdentity, relation?.type).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (!isCurrentRequest()) return null;

      const contents = [
        ...(metadata
          ? [
              {
                value: buildQueryEditorTableHoverMarkdown({
                  schema: hoverSchema!,
                  table: { name: relation!.name, tableType: relation!.type },
                  columns: metadata.columns,
                  indexes: metadata.indexes,
                  ddl,
                }),
              },
            ]
          : []),
        ...(lspHover ? [{ value: lspHover.contents }] : []),
      ];
      if (contents.length === 0) return null;

      const word = model.getWordAtPosition(position);
      const fallbackRange = word
        ? new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          )
        : undefined;
      return {
        contents,
        range: lspHover?.range
          ? toMonacoRange(monaco, lspHover.range)
          : fallbackRange,
      };
    },
  });
}

export function useLspHoverProviderCoordinator(
  options: LspHoverProviderCoordinatorOptions,
) {
  const runtimeRef = useRef<LspHoverProviderRuntime>(options);
  runtimeRef.current = options;

  useTableDdlHoverSearchWidget({
    editor: options.editor,
    monaco: options.monaco,
    runtime: options,
    enabled:
      options.isActivePane &&
      Boolean(options.editor) &&
      options.showTableDdlHoverPreview &&
      options.supportsTableBrowsing,
  });

  useEffect(() => {
    if (!options.isActivePane || !options.monaco) return;
    const provider = registerLspHoverProvider({
      editorLanguageId: options.editorLanguageId,
      getRuntime: () => runtimeRef.current,
      lspClient: options.lspClient,
      monaco: options.monaco,
    });
    // Monaco's IDisposable#dispose reads instance state. React calls effect
    // cleanups as standalone functions, so do not return the method unbound.
    return () => provider.dispose();
  }, [
    options.editorLanguageId,
    options.isActivePane,
    options.lspClient,
    options.monaco,
  ]);
}
