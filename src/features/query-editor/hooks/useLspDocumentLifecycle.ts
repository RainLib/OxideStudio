import { useEffect, useRef } from "react";
import type { Monaco } from "@monaco-editor/react";
import { extractLspDocumentIdentity } from "@/services/lsp";
import {
  enqueueLspDocumentSync,
  syncLspModelBeforeCompletion,
  type LspDocumentSyncClient,
} from "../model/lspDocumentSync";

export type LspDocumentLifecycleClient = LspDocumentSyncClient & {
  didClose: (uri: string) => Promise<void>;
};

type QueryDocumentTab = {
  id: string;
  type: string;
};

type UseLspDocumentLifecycleOptions = {
  activeTabId?: string | null;
  activeDocumentText: string;
  canUseLsp: boolean;
  documentLanguageId: string;
  documentUri?: string | null;
  lifecycleKey?: unknown;
  lspClient: LspDocumentLifecycleClient;
  lspReady: boolean;
  lspSessionKey: string;
  monaco?: Monaco | null;
  tabs: QueryDocumentTab[];
};

type DocumentSession = {
  sessionKey: string;
  client: LspDocumentLifecycleClient;
};

// A remounted editor can reuse the same virtual URI before an old didOpen has
// settled. Serialize by LSP session + URI across hook instances so the old
// cleanup always finishes before the replacement opens the document.
const lifecycleSyncChains = new Map<string, Promise<void>>();
export const LSP_DOCUMENT_CHANGE_DEBOUNCE_MS = 120;

/**
 * Owns the virtual LSP document registry used by Monaco providers.
 *
 * A generation token closes late `didOpen` results after a tab, connection or
 * LSP session change. This keeps the server document set and the local shadow
 * maps consistent without disposing Monaco models during transient restarts.
 */
export function useLspDocumentLifecycle({
  activeTabId,
  activeDocumentText,
  canUseLsp,
  documentLanguageId,
  documentUri,
  lifecycleKey,
  lspClient,
  lspReady,
  lspSessionKey,
  monaco,
  tabs,
}: UseLspDocumentLifecycleOptions) {
  const openedDocumentsRef = useRef<Set<string>>(new Set());
  const documentSessionsRef = useRef<Map<string, DocumentSession>>(new Map());
  const documentVersionsRef = useRef<Map<string, number>>(new Map());
  const documentTextsRef = useRef<Map<string, string>>(new Map());
  const completionRequestGenerationRef = useRef<Map<string, number>>(new Map());
  const activeDocumentUriRef = useRef<string | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const requestedDocumentKeyRef = useRef<string | null>(null);
  const documentChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const runtimeKey = lspReady ? lspSessionKey : null;
  const previousRuntimeKeyRef = useRef<string | null>(runtimeKey);
  const activeSyncKey =
    lspReady && canUseLsp && activeTabId && documentUri
      ? `${lspSessionKey}\u0000${activeTabId}\u0000${documentUri}`
      : null;
  const previousActiveSyncKeyRef = useRef<string | null>(activeSyncKey);

  if (previousActiveSyncKeyRef.current !== activeSyncKey) {
    previousActiveSyncKeyRef.current = activeSyncKey;
    lifecycleGenerationRef.current += 1;
    requestedDocumentKeyRef.current = null;
  }

  const forgetDocument = (uri: string) => {
    openedDocumentsRef.current.delete(uri);
    documentVersionsRef.current.delete(uri);
    documentTextsRef.current.delete(uri);
    completionRequestGenerationRef.current.delete(uri);
  };

  const clearMarkers = (uri: string) => {
    if (!monaco) return;
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (model) monaco.editor.setModelMarkers(model, "sql-lsp", []);
  };

  useEffect(() => {
    if (previousRuntimeKeyRef.current === runtimeKey) return;
    previousRuntimeKeyRef.current = runtimeKey;
    activeDocumentUriRef.current = null;

    for (const [uri, owner] of documentSessionsRef.current) {
      documentSessionsRef.current.delete(uri);
      forgetDocument(uri);
      void owner.client.didClose(uri).catch(() => undefined);
    }
  }, [runtimeKey]);

  useEffect(() => {
    if (!lspReady || !activeTabId || !documentUri || !canUseLsp) {
      activeDocumentUriRef.current = null;
      return;
    }
    activeDocumentUriRef.current = documentUri;
    const generation = lifecycleGenerationRef.current;

    // One tab can acquire a different virtual URI when its dialect/package
    // changes. Close the previous URI before opening the replacement.
    for (const staleUri of Array.from(openedDocumentsRef.current)) {
      const staleIdentity = extractLspDocumentIdentity(staleUri);
      if (staleUri === documentUri || staleIdentity?.tabId !== activeTabId) {
        continue;
      }
      forgetDocument(staleUri);
      const staleOwner = documentSessionsRef.current.get(staleUri);
      documentSessionsRef.current.delete(staleUri);
      if (staleOwner) void staleOwner.client.didClose(staleUri);
    }

    const syncChainKey = `${lspSessionKey}\u0000${documentUri}`;
    const synchronizeDocument = () => {
      documentChangeTimerRef.current = null;
      void enqueueLspDocumentSync(
        lifecycleSyncChains,
        syncChainKey,
        async () => {
          if (
            lifecycleGenerationRef.current !== generation ||
            activeDocumentUriRef.current !== documentUri
          ) {
            return;
          }

          const owner = documentSessionsRef.current.get(documentUri);
          if (owner?.sessionKey !== lspSessionKey) {
            documentSessionsRef.current.delete(documentUri);
            if (owner) {
              await owner.client.didClose(documentUri).catch(() => undefined);
            }
          }

          await syncLspModelBeforeCompletion({
            uri: documentUri,
            model: { getValue: () => activeDocumentText },
            languageId: documentLanguageId,
            client: lspClient,
            openedDocuments: openedDocumentsRef.current,
            documentVersions: documentVersionsRef.current,
            documentTexts: documentTextsRef.current,
          });

          if (
            lifecycleGenerationRef.current !== generation ||
            activeDocumentUriRef.current !== documentUri ||
            !openedDocumentsRef.current.has(documentUri)
          ) {
            forgetDocument(documentUri);
            await lspClient.didClose(documentUri).catch(() => undefined);
            return;
          }

          documentSessionsRef.current.set(documentUri, {
            sessionKey: lspSessionKey,
            client: lspClient,
          });
        },
      ).catch((error) => {
        // Completion retries the exact failed revision through this same FIFO.
        console.debug("[LSP] Deferred document synchronization failed:", error);
      });
    };

    // didOpen remains immediate. Once a document is open (or its open is
    // already queued), collapse rapid editor revisions into the latest text.
    // Completion still calls syncLspModelBeforeCompletion directly, so an
    // explicit request never observes a stale revision while ordinary typing
    // cannot build an unbounded FIFO of full-document didChange payloads.
    const hasOpenOrRequestedDocument =
      openedDocumentsRef.current.has(documentUri) ||
      documentSessionsRef.current.has(documentUri) ||
      requestedDocumentKeyRef.current === syncChainKey;
    if (!hasOpenOrRequestedDocument) {
      requestedDocumentKeyRef.current = syncChainKey;
      synchronizeDocument();
      return;
    }

    const timer = setTimeout(
      synchronizeDocument,
      LSP_DOCUMENT_CHANGE_DEBOUNCE_MS,
    );
    documentChangeTimerRef.current = timer;
    return () => {
      if (documentChangeTimerRef.current !== timer) return;
      clearTimeout(timer);
      documentChangeTimerRef.current = null;
    };
  }, [
    activeDocumentText,
    activeTabId,
    canUseLsp,
    documentLanguageId,
    documentUri,
    lifecycleKey,
    lspClient,
    lspReady,
    lspSessionKey,
  ]);

  useEffect(() => {
    const currentDocumentTabIds = new Set(
      tabs.filter((tab) => tab.type === "query").map((tab) => tab.id),
    );

    for (const uri of Array.from(openedDocumentsRef.current)) {
      const identity = extractLspDocumentIdentity(uri);
      if (identity && currentDocumentTabIds.has(identity.tabId)) continue;

      forgetDocument(uri);
      const owner = documentSessionsRef.current.get(uri);
      documentSessionsRef.current.delete(uri);
      if (owner) void owner.client.didClose(uri);
      clearMarkers(uri);
    }
  }, [monaco, tabs]);

  useEffect(() => {
    return () => {
      lifecycleGenerationRef.current += 1;
      activeDocumentUriRef.current = null;
      if (documentChangeTimerRef.current !== null) {
        clearTimeout(documentChangeTimerRef.current);
        documentChangeTimerRef.current = null;
      }
      for (const [uri, owner] of documentSessionsRef.current) {
        void owner.client.didClose(uri);
        clearMarkers(uri);
      }
      openedDocumentsRef.current.clear();
      documentSessionsRef.current.clear();
      documentVersionsRef.current.clear();
      documentTextsRef.current.clear();
      completionRequestGenerationRef.current.clear();
    };
  }, [monaco]);

  return {
    openedDocumentsRef,
    documentVersionsRef,
    documentTextsRef,
    completionRequestGenerationRef,
  };
}
