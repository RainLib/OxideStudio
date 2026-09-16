import { getLspProjectDocumentUri } from "@/services/lsp/document";
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
  const opened = new Map<string, OpenProjectLspDocument>();
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
        if (previous.sessionKey === sessionKey && nextDocuments.has(uri))
          continue;
        opened.delete(uri);
        await previous.client.didClose(uri);
      }
      for (const [uri, document] of nextDocuments) {
        if (isStale()) return;
        const previous = opened.get(uri);
        if (
          previous?.sessionKey === sessionKey &&
          previous.content === document.content
        )
          continue;
        const version = (previous?.version || 0) + 1;
        try {
          if (previous?.sessionKey === sessionKey) {
            await lspClient.didChange(uri, document.content, version);
          } else {
            await lspClient.didOpen(uri, document.content, version, languageId);
          }
        } catch (error) {
          if (!previous) await lspClient.didClose(uri).catch(() => undefined);
          throw error;
        }
        if (isStale()) {
          // closeAll already owns previously recorded documents. A newly
          // opened document was not in its snapshot and must be closed here.
          if (!previous || opened.get(uri) === previous) {
            opened.delete(uri);
            await lspClient.didClose(uri);
          }
          return;
        }
        opened.set(uri, {
          client: lspClient,
          sessionKey,
          content: document.content,
          version,
        });
      }
    });
  };

  const closeAll = () => {
    generation += 1;
    const documents = [...opened];
    opened.clear();
    return enqueue(async () => {
      await Promise.allSettled(
        documents.map(([uri, document]) => document.client.didClose(uri)),
      );
    });
  };

  return { synchronize, closeAll };
}
