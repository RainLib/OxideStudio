import { getLspProjectDocumentUri } from "@/services/lsp/document";
import {acquireLspDocument,type LspDocumentLease} from "@/services/lsp/documentOwnership";
import type {
  OpenProjectLspDocument,
  ProjectDocumentClient,
} from "../model/syncTypes";

interface ProjectDocumentSyncRequest {
  activeProjectId: string;
  lspClient: ProjectDocumentClient;
  documents: Array<{ relativePath: string; content: string }>;
  languageId: string;
  isCancelled?: () => boolean;
}

/** One owner serializes document RPCs and invalidates work before closing. */
export function createProjectDocumentSync() {
  const opened = new Map<string, OpenProjectLspDocument & {lease:LspDocumentLease;languageId:string;runtime:object|string}>();
  let generation = 0;
  let pending: Promise<void> = Promise.resolve();
  const enqueue = (operation: () => Promise<void>) => {
    const result = pending.then(operation);
    // A failed transport must not prevent a later context from synchronizing.
    pending = result.catch(() => undefined);
    return result;
  };

  const synchronize = (request: ProjectDocumentSyncRequest) => {
    const requestedGeneration = generation;
    const isStale = () =>
      requestedGeneration !== generation || request.isCancelled?.() === true;
    return enqueue(async () => {
      if (isStale()) return;
      const { activeProjectId, lspClient, documents, languageId } = request;
      const sessionKey = lspClient.getSessionKey();
      const runtime=lspClient.getRuntimeSnapshot?.().generation??sessionKey;
      const nextDocuments = new Map(
        documents.map((document) => [
          getLspProjectDocumentUri(
            activeProjectId,
            document.relativePath,
            languageId,
          ),
          document,
        ]),
      );
      for (const [uri, previous] of opened) {
        if (isStale()) return;
        if (previous.sessionKey === sessionKey && previous.client===lspClient && previous.runtime===runtime && nextDocuments.has(uri))
          continue;
        opened.delete(uri);
        await previous.lease.release();
      }
      for (const [uri, document] of nextDocuments) {
        if (isStale()) return;
        const previous = opened.get(uri);
        if (
          previous?.sessionKey === sessionKey &&
          previous.client===lspClient && previous.runtime===runtime && previous.content === document.content && previous.languageId===languageId
        )
          continue;
        const owned=previous??{client:lspClient,sessionKey,content:"",version:0,languageId,runtime,
          lease:acquireLspDocument({client:lspClient,sessionKey,uri,priority:0})};
        opened.set(uri,owned);
        try {
          const shadow=await owned.lease.synchronize(document.content,languageId);
          owned.version=shadow.version;
        } catch (error) {
          if (!previous) {if(opened.get(uri)===owned)opened.delete(uri);await owned.lease.release().catch(() => undefined);}
          throw error;
        }
        if (isStale()) {
          // closeAll captures even an in-flight lease; otherwise cancellation
          // retires only this index owner, preserving any live editor owner.
          if (opened.get(uri) === owned) {
            opened.delete(uri);
            await owned.lease.release();
          }
          return;
        }
        owned.content=document.content;owned.languageId=languageId;
      }
    });
  };

  const closeAll = () => {
    generation += 1;
    const documents = [...opened];
    opened.clear();
    return enqueue(async () => {
      await Promise.allSettled(
        documents.map(([, document]) => document.lease.release()),
      );
    });
  };

  return { synchronize, closeAll };
}
