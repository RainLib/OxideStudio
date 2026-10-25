export type LspDocumentSyncClient = {
  didOpen: (
    uri: string,
    text: string,
    version: number,
    languageId: string,
  ) => Promise<void>;
  didChange: (uri: string, text: string, version: number) => Promise<void>;
};

export type LspTextModel = {
  getValue: () => string;
};

/** One FIFO tail per virtual LSP document URI. */
export type LspDocumentSyncChains = Map<string, Promise<void>>;
const shadowListeners=new WeakMap<Map<string,number>,Set<(uri:string)=>void>>();
const ownedSynchronizers = new WeakMap<Map<string,number>, Map<string,(model:LspTextModel)=>Promise<void>>>();
export function bindLspDocumentSynchronizer(versions:Map<string,number>,uri:string,sync:(model:LspTextModel)=>Promise<void>){
  let bindings=ownedSynchronizers.get(versions);if(!bindings)ownedSynchronizers.set(versions,bindings=new Map());bindings.set(uri,sync);
  // Keep a tombstone while old providers retain these shadow maps. Falling
  // back to a raw didOpen after owner disposal would resurrect a closed URI.
  return ()=>{if(bindings!.get(uri)===sync)bindings!.set(uri,()=>Promise.reject(new Error("LSP document owner was released")));};
}
export function commitLspDocumentShadow(options:{uri:string;text:string;version:number;openedDocuments:Set<string>;documentVersions:Map<string,number>;documentTexts:Map<string,string>}){
  const {uri,text,version,openedDocuments,documentVersions,documentTexts}=options;
  const changed=documentVersions.get(uri)!==version||documentTexts.get(uri)!==text;
  openedDocuments.add(uri);documentVersions.set(uri,version);documentTexts.set(uri,text);if(changed)notifyShadow(documentVersions,uri);
}
export function subscribeLspDocumentShadow(versions:Map<string,number>,listener:(uri:string)=>void){
  const listeners=shadowListeners.get(versions)||new Set<(uri:string)=>void>();listeners.add(listener);shadowListeners.set(versions,listeners);
  return ()=>{listeners.delete(listener);if(!listeners.size)shadowListeners.delete(versions);};
}
function notifyShadow(versions:Map<string,number>,uri:string){
  for(const listener of shadowListeners.get(versions)||[]){try{listener(uri);}catch(error){console.error("[LSP] Document shadow listener failed:",error);}}
}

/**
 * Queue a document operation after every prior operation for the same URI.
 *
 * The returned promise preserves the task failure for UI telemetry, while the
 * stored tail always settles successfully so one transient transport failure
 * cannot poison all later edits for that document.
 */
export function enqueueLspDocumentSync<T>(
  chains: LspDocumentSyncChains,
  uri: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = chains.get(uri) || Promise.resolve();
  const result = previous.catch(() => undefined).then(task);
  const continuation = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(uri, continuation);
  void continuation.finally(() => {
    if (chains.get(uri) === continuation) chains.delete(uri);
  });
  return result;
}

/**
 * Bring the LSP shadow document up to date before a latency-sensitive request.
 *
 * Monaco change notifications are intentionally debounced elsewhere. Completion
 * cannot wait for that debounce because doing so lets a request observe the
 * previous model revision. This coordinator is kept independent of React and
 * Monaco so all completion entry points can share the same ordering contract.
 */
export async function syncLspModelBeforeCompletion(options: {
  uri: string;
  model: LspTextModel;
  languageId: string;
  client: LspDocumentSyncClient;
  openedDocuments: Set<string>;
  documentVersions: Map<string, number>;
  documentTexts?: Map<string, string>;
}) {
  const {
    uri,
    model,
    languageId,
    client,
    openedDocuments,
    documentVersions,
    documentTexts,
  } = options;
  const ownedSync=ownedSynchronizers.get(documentVersions)?.get(uri);
  if(ownedSync){await ownedSync(model);return;}
  const text = model.getValue();
  if (openedDocuments.has(uri) && documentTexts?.get(uri) === text) return;

  const version = (documentVersions.get(uri) || 0) + 1;

  if (openedDocuments.has(uri)) {
    await client.didChange(uri, text, version);
    // Treat the local shadow state as committed only after the server accepts
    // the revision. Otherwise the next completion request would incorrectly
    // skip the document change after a transient LSP restart.
    documentVersions.set(uri, version);
    documentTexts?.set(uri, text);
    notifyShadow(documentVersions,uri);
    return;
  }

  await client.didOpen(uri, text, version, languageId);
  // `didOpen` can fail when the session is restarting. Do not mark it opened
  // until it succeeds, or a retry would send `didChange` to no document.
  openedDocuments.add(uri);
  documentVersions.set(uri, version);
  documentTexts?.set(uri, text);
  notifyShadow(documentVersions,uri);
}
