import { useCallback, useEffect, useMemo, useRef } from "react";
import {useLspRuntimeSnapshot,type LspRuntimePort} from "@/hooks/useLspRuntimeSnapshot";
import type { Monaco } from "@monaco-editor/react";
import { extractLspDocumentIdentity } from "@/services/lsp";
import {acquireLspDocument,type LspDocumentLease} from "@/services/lsp/documentOwnership";
import {refreshSharedModelPublication} from "../model/sharedModelPublication";
import {
  enqueueLspDocumentSync,
  bindLspDocumentSynchronizer,
  commitLspDocumentShadow,
  type LspDocumentSyncClient,
} from "../model/lspDocumentSync";

export type LspDocumentLifecycleClient = LspDocumentSyncClient & LspRuntimePort & {
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
  tabId:string;
  sessionKey: string;
  client: LspDocumentLifecycleClient;
  lease: LspDocumentLease;
  unbind: () => void;
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
  lifecycleKey:providedLifecycleKey,
  lspClient,
  lspReady:requestedLspReady,
  lspSessionKey,
  monaco,
  tabs,
}: UseLspDocumentLifecycleOptions) {
  const process=useLspRuntimeSnapshot(lspClient);
  const lspReady=requestedLspReady&&process.ready;
  const lifecycleKey=useMemo(()=>({provided:providedLifecycleKey,process:process.generation}),[providedLifecycleKey,process]);
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
  const previousRuntimeKeyRef = useRef({key:runtimeKey,lifecycleKey});
  const previousLifecycleKeyRef=useRef(lifecycleKey);
  const activeSyncKey =
    lspReady && canUseLsp && activeTabId && documentUri
      ? `${lspSessionKey}\u0000${activeTabId}\u0000${documentUri}`
      : null;
  const previousActiveSyncKeyRef = useRef<string | null>(activeSyncKey);

  if (previousActiveSyncKeyRef.current !== activeSyncKey||previousLifecycleKeyRef.current!==lifecycleKey) {
    previousLifecycleKeyRef.current=lifecycleKey;
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
    if (model&&!refreshSharedModelPublication(monaco.editor,model,"sql-lsp")) monaco.editor.setModelMarkers(model, "sql-lsp", []);
  };

  const closeOwnedDocument=(_uri:string,owner:DocumentSession)=>{owner.unbind();return owner.lease.release();};
  const syncDocument=useCallback((model:{getValue:()=>string})=>{
    if(!lspReady||!canUseLsp||!activeTabId||!documentUri)return Promise.reject(new Error("Document source is unavailable"));
    const generation=lifecycleGenerationRef.current,uri=documentUri;
    return enqueueLspDocumentSync(lifecycleSyncChains,lspSessionKey+"\u0000"+uri,async()=>{
      if(generation!==lifecycleGenerationRef.current||activeDocumentUriRef.current!==uri)throw new Error("Document source changed before synchronization");
      let owner=documentSessionsRef.current.get(uri);
      if(owner&&(owner.sessionKey!==lspSessionKey||owner.client!==lspClient)){
        documentSessionsRef.current.delete(uri);forgetDocument(uri);await closeOwnedDocument(uri,owner).catch(()=>undefined);owner=undefined;
      }
      if(!owner){
        const lease=acquireLspDocument({client:lspClient,sessionKey:lspSessionKey,uri,priority:1,onClose:monaco?()=>clearMarkers(uri):undefined,onCloseKey:monaco??undefined,onShadow:shadow=>{
          if(documentSessionsRef.current.get(uri)?.lease!==lease)return;
          commitLspDocumentShadow({uri,text:shadow.text,version:shadow.version,openedDocuments:openedDocumentsRef.current,documentVersions:documentVersionsRef.current,documentTexts:documentTextsRef.current});
        }});
        owner={tabId:activeTabId,sessionKey:lspSessionKey,client:lspClient,lease,unbind:bindLspDocumentSynchronizer(documentVersionsRef.current,uri,async next=>{
          const isCurrent=()=>activeDocumentUriRef.current===uri&&documentSessionsRef.current.get(uri)?.lease===lease;
          if(!isCurrent())throw new Error("Document source changed before synchronization");
          await lease.synchronize(next.getValue(),documentLanguageId);
          if(!isCurrent())throw new Error("Document source changed during synchronization");
        })};
        documentSessionsRef.current.set(uri,owner);
      }
      await owner.lease.synchronize(model.getValue(),documentLanguageId);
      if(generation!==lifecycleGenerationRef.current||activeDocumentUriRef.current!==uri){
        if(documentSessionsRef.current.get(uri)===owner){documentSessionsRef.current.delete(uri);forgetDocument(uri);}
        await closeOwnedDocument(uri,owner).catch(()=>undefined);throw new Error("Document source changed during synchronization");
      }
    });
  },[lspReady,canUseLsp,activeTabId,documentUri,documentLanguageId,lspClient,lspSessionKey,lifecycleKey,monaco]);

  useEffect(() => {
    if(previousRuntimeKeyRef.current.key===runtimeKey&&previousRuntimeKeyRef.current.lifecycleKey===lifecycleKey)return;
    previousRuntimeKeyRef.current={key:runtimeKey,lifecycleKey};activeDocumentUriRef.current=null;
    for(const [uri,owner] of documentSessionsRef.current){documentSessionsRef.current.delete(uri);forgetDocument(uri);void closeOwnedDocument(uri,owner).catch(()=>undefined);}
  },[runtimeKey,lifecycleKey]);

  useEffect(() => {
    if (!lspReady || !activeTabId || !documentUri || !canUseLsp) {
      activeDocumentUriRef.current = null;
      return;
    }
    activeDocumentUriRef.current = documentUri;

    // One tab can acquire a different virtual URI when its dialect/package
    // changes. Close the previous URI before opening the replacement.
    for (const staleUri of Array.from(openedDocumentsRef.current)) {
      const staleIdentity = extractLspDocumentIdentity(staleUri);
      const staleTabId=staleIdentity?.tabId??documentSessionsRef.current.get(staleUri)?.tabId;
      if (staleUri === documentUri || staleTabId !== activeTabId) {
        continue;
      }
      forgetDocument(staleUri);
      const staleOwner = documentSessionsRef.current.get(staleUri);
      documentSessionsRef.current.delete(staleUri);
      if (staleOwner) void closeOwnedDocument(staleUri,staleOwner).catch(()=>undefined);
    }

    const syncChainKey = `${lspSessionKey}\u0000${documentUri}`;
    const synchronizeDocument = () => {
      documentChangeTimerRef.current = null;
      const current=monaco?.editor.getModel(monaco.Uri.parse(documentUri));
      void syncDocument(current&&!current.isDisposed()?current:{getValue:()=>activeDocumentText}).catch((error) => {
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
    syncDocument,
    monaco,
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
      const ownerTabId=identity?.tabId??documentSessionsRef.current.get(uri)?.tabId??(uri===documentUri?activeTabId:undefined);
      if (ownerTabId&&currentDocumentTabIds.has(ownerTabId)) continue;

      forgetDocument(uri);
      const owner = documentSessionsRef.current.get(uri);
      documentSessionsRef.current.delete(uri);
      if (owner) void closeOwnedDocument(uri,owner).catch(()=>undefined);
    }
  }, [monaco, tabs,documentUri,activeTabId]);

  useEffect(() => {
    return () => {
      lifecycleGenerationRef.current += 1;
      activeDocumentUriRef.current = null;
      if (documentChangeTimerRef.current !== null) {
        clearTimeout(documentChangeTimerRef.current);
        documentChangeTimerRef.current = null;
      }
      for (const [uri, owner] of documentSessionsRef.current) {
        void closeOwnedDocument(uri,owner).catch(()=>undefined);
      }
      openedDocumentsRef.current.clear();
      documentSessionsRef.current.clear();
      documentVersionsRef.current.clear();
      documentTextsRef.current.clear();
      completionRequestGenerationRef.current.clear();
    };
  }, [monaco]);

  return {
    syncDocument,
    openedDocumentsRef,
    documentVersionsRef,
    documentTextsRef,
    completionRequestGenerationRef,
  };
}
