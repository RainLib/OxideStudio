/** Shared wire ownership for editor panes and project-index snapshots. */
export type OwnedLspDocumentClient = {
  didOpen(uri: string, text: string, version: number, languageId: string): Promise<void>;
  didChange(uri: string, text: string, version: number): Promise<void>;
  didClose(uri: string): Promise<void>;
  getRuntimeSnapshot?: () => { generation: object; ready?: boolean };
};
export type LspDocumentShadow = { text: string; version: number; languageId: string };
type Owner = {
  priority: number;
  order: number;
  desired?: { text: string; languageId: string };
  onShadow?: (shadow: LspDocumentShadow) => void;
};
type Entry = {
  owners: Set<Owner>;
  onClose: Map<object,() => void>;
};
type Slot = {
  entries: Map<object | string, Entry>;
  pending: Promise<void>;
  wire?: { entry: Entry; shadow?: LspDocumentShadow };
  order: number;
};
const clients = new WeakMap<OwnedLspDocumentClient, Map<string, Map<string, Slot>>>();

export type LspDocumentLease = {
  synchronize(text: string, languageId: string): Promise<LspDocumentShadow>;
  release(): Promise<void>;
};

export function acquireLspDocument(options: {
  client: OwnedLspDocumentClient;
  sessionKey: string;
  uri: string;
  /** An unsaved editor (1) takes precedence over a project snapshot (0). */
  priority: number;
  onShadow?: (shadow: LspDocumentShadow) => void;
  onClose?: () => void;
  onCloseKey?: object;
}): LspDocumentLease {
  const { client, sessionKey, uri } = options;
  let sessions = clients.get(client);
  if (!sessions) clients.set(client, sessions = new Map());
  let documents = sessions.get(sessionKey);
  if (!documents) sessions.set(sessionKey, documents = new Map());
  let slot = documents.get(uri);
  if (!slot) documents.set(uri, slot = { entries: new Map(), pending: Promise.resolve(), order: 0 });
  const shared = slot, epoch = client.getRuntimeSnapshot?.().generation ?? sessionKey;
  let entry = shared.entries.get(epoch);
  if (!entry) shared.entries.set(epoch, entry = { owners: new Set(), onClose: new Map() });
  const owned = entry, owner: Owner = { priority: options.priority, order: 0, onShadow: options.onShadow };
  owned.owners.add(owner);
  if (options.onClose) owned.onClose.set(options.onCloseKey??options.onClose,options.onClose);
  let released: Promise<void> | undefined;
  const notify = (callback: () => void) => {
    try { callback(); } catch (error) { console.error("[LSP] Document ownership observer failed", error); }
  };
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = shared.pending.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    shared.pending = tail;
    void tail.then(() => {
      if (shared.pending !== tail || shared.entries.size || shared.wire) return;
      if (documents!.get(uri) === shared) documents!.delete(uri);
      if (!documents!.size && sessions!.get(sessionKey) === documents) sessions!.delete(sessionKey);
    });
    return result;
  };
  const runtimeIsCurrent=()=>{const current=client.getRuntimeSnapshot?.();return !current||current.generation===epoch&&current.ready!==false;};
  const winner = () => {
    let selected:Owner|undefined;
    for(const value of owned.owners)if(value.desired&&(!selected||value.priority>selected.priority||value.priority===selected.priority&&value.order>selected.order))selected=value;
    return selected;
  };
  const publish = (shadow: LspDocumentShadow,priority:number,order:number) => {
    for (const value of owned.owners) {
      // Panes showing one URI share the committed buffer. Releasing the last
      // writer must not restore a sibling's earlier copy. Lower-priority disk
      // snapshots retain their own source for a later editor-to-index handoff.
      if(value.priority===priority&&value.order<=order){value.desired={text:shadow.text,languageId:shadow.languageId};value.order=order;}
      if (value.onShadow) notify(() => value.onShadow!(shadow));
    }
  };
  const closeWire = async (closing: Entry, final: boolean) => {
    if (shared.wire?.entry !== closing) return;
    await client.didClose(uri);
    shared.wire = undefined;
    if (final) for (const callback of closing.onClose.values()) notify(callback);
  };
  const synchronizeWinner = async () => {
    const selected = winner();
    if (!selected?.desired) return undefined;
    if (shared.wire && shared.wire.entry !== owned) await closeWire(shared.wire.entry, !shared.wire.entry.owners.size);
    let shadow = shared.wire?.shadow;
    const desired = selected.desired;
    const priority=selected.priority,order=selected.order;
    if (shadow && shadow.languageId !== desired.languageId) {
      await closeWire(owned, false);
      shadow = undefined;
    }
    if (shadow?.text === desired.text) { publish(shadow,priority,order); return shadow; }
    const next = { ...desired, version: (shadow?.version ?? 0) + 1 };
    if (shadow) await client.didChange(uri, next.text, next.version);
    else {
      shared.wire = { entry: owned };
      try { await client.didOpen(uri, next.text, next.version, next.languageId); }
      catch (error) {
        // A rejected notification can have reached the server. Retire it before
        // retrying, rather than pretending it was a committed local revision.
        await closeWire(owned, false).catch(() => undefined);
        throw error;
      }
    }
    shared.wire = { entry: owned, shadow: next };
    publish(next,priority,order);
    return next;
  };
  return {
    synchronize(text, languageId) {
      if (released) return Promise.reject(new Error("LSP document owner was released"));
      if (!runtimeIsCurrent()) return Promise.reject(new Error("LSP document process changed"));
      owner.desired = { text, languageId };
      owner.order = ++shared.order;
      return enqueue(async () => {
        if (released) throw new Error("LSP document owner was released");
        if (!runtimeIsCurrent()) throw new Error("LSP document process changed");
        const shadow = await synchronizeWinner();
        if (!shadow) throw new Error("LSP document source is unavailable");
        return shadow;
      });
    },
    release() {
      if (released) return released;
      owned.owners.delete(owner);
      if (!owned.owners.size && shared.entries.get(epoch) === owned) shared.entries.delete(epoch);
      released = enqueue(async () => {
        if (!owned.owners.size) await closeWire(owned, true);
        else if (shared.wire?.entry === owned) await synchronizeWinner();
      });
      return released;
    },
  };
}
