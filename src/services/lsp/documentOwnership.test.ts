import {describe,expect,it,vi} from "vitest";
import {acquireLspDocument,type OwnedLspDocumentClient} from "./documentOwnership";
import {createLspRuntimeObservation} from "./client/runtimeObservation";

function fixture(){
  const process=createLspRuntimeObservation();process.setReady(true);
  const client={didOpen:vi.fn<OwnedLspDocumentClient["didOpen"]>(async()=>{}),didChange:vi.fn<OwnedLspDocumentClient["didChange"]>(async()=>{}),didClose:vi.fn<OwnedLspDocumentClient["didClose"]>(async()=>{}),getRuntimeSnapshot:process.getSnapshot};
  const acquire=(priority=1,uri="oxide://project/a/query.sql",sessionKey="session")=>acquireLspDocument({client,priority,uri,sessionKey});
  return {client,process,acquire};
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

describe("shared LSP document wire ownership",()=>{
  it("deduplicates opens and publishes one monotonic version to every live owner",async()=>{
    const f=fixture(),left=vi.fn(),right=vi.fn(),close=vi.fn();
    const a=acquireLspDocument({client:f.client,sessionKey:"session",uri:"uri",priority:1,onShadow:left,onClose:close});
    const b=acquireLspDocument({client:f.client,sessionKey:"session",uri:"uri",priority:1,onShadow:right});
    await a.synchronize("SELECT 1","sql");await b.synchronize("SELECT 1","sql");
    expect(f.client.didOpen).toHaveBeenCalledTimes(1);expect(right).toHaveBeenLastCalledWith({text:"SELECT 1",version:1,languageId:"sql"});
    await b.synchronize("SELECT 2","sql");expect(left).toHaveBeenLastCalledWith({text:"SELECT 2",version:2,languageId:"sql"});
    await a.release();expect(f.client.didClose).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
    await b.synchronize("SELECT 3","sql");expect(f.client.didChange).toHaveBeenLastCalledWith("uri","SELECT 3",3);
    await b.release();await b.release();expect(f.client.didClose).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps unsaved editor text above snapshots and restores the newest disk snapshot on release",async()=>{
    const f=fixture(),index=f.acquire(0),editor=f.acquire();
    await index.synchronize("disk","sql");await editor.synchronize("unsaved","sql");await index.synchronize("new disk","sql");
    expect(f.client.didChange).toHaveBeenCalledTimes(1);
    await editor.release();expect(f.client.didChange).toHaveBeenLastCalledWith("oxide://project/a/query.sql","new disk",3);
    expect(f.client.didClose).not.toHaveBeenCalled();await index.release();expect(f.client.didClose).toHaveBeenCalledTimes(1);
  });
  it("retains the latest editor buffer when its most recent writer unmounts",async()=>{
    const f=fixture(),a=f.acquire(),b=f.acquire();await a.synchronize("one","sql");await b.synchronize("one","sql");
    await b.synchronize("two","sql");await b.release();expect(f.client.didChange).toHaveBeenCalledTimes(1);
    await a.synchronize("two","sql");expect(f.client.didChange).toHaveBeenCalledTimes(1);await a.release();
  });
  it("rejects a newly acquired owner while the process is not ready",async()=>{
    const f=fixture();f.process.setReady(false);const a=f.acquire();await expect(a.synchronize("one","sql")).rejects.toThrow("process changed");
    expect(f.client.didOpen).not.toHaveBeenCalled();await a.release();
  });
  it("does not close a held shared open when one of its owners releases",async()=>{
    const f=fixture(),gate=deferred(),a=f.acquire(),b=f.acquire();f.client.didOpen.mockImplementationOnce(()=>gate.promise);
    const opening=a.synchronize("same","sql");await vi.waitFor(()=>expect(f.client.didOpen).toHaveBeenCalledOnce());
    const closing=a.release(),sibling=b.synchronize("same","sql");gate.resolve();await Promise.all([opening,closing,sibling]);
    expect(f.client.didOpen).toHaveBeenCalledOnce();expect(f.client.didClose).not.toHaveBeenCalled();
    await expect(a.synchronize("stale","sql")).rejects.toThrow("released");await b.release();
  });
  it("prevents an owner released before its queued work starts from opening the URI",async()=>{
    const f=fixture(),a=f.acquire(),opening=a.synchronize("obsolete","sql").catch(error=>error),closing=a.release();
    expect(await opening).toBeInstanceOf(Error);await closing;expect(f.client.didOpen).not.toHaveBeenCalled();
  });
  it("retries a failed change without committing a phantom version",async()=>{
    const f=fixture(),a=f.acquire();await a.synchronize("one","sql");f.client.didChange.mockRejectedValueOnce(new Error("transport"));
    await expect(a.synchronize("two","sql")).rejects.toThrow("transport");await a.synchronize("two","sql");
    expect(f.client.didChange.mock.calls.map(call=>call[2])).toEqual([2,2]);await a.release();
  });
  it("retires a failed open and retries it as a new open",async()=>{
    const f=fixture(),a=f.acquire();f.client.didOpen.mockRejectedValueOnce(new Error("transport"));
    await expect(a.synchronize("one","sql")).rejects.toThrow("transport");expect(f.client.didClose).toHaveBeenCalledOnce();
    await a.synchronize("one","sql");expect(f.client.didOpen.mock.calls.map(call=>call[2])).toEqual([1,1]);await a.release();
  });
  it("recovers a failed final close before opening a replacement owner",async()=>{
    const f=fixture(),a=f.acquire();await a.synchronize("one","sql");f.client.didClose.mockRejectedValueOnce(new Error("transport"));
    await expect(a.release()).rejects.toThrow("transport");const b=f.acquire();await b.synchronize("two","sql");
    expect(f.client.didClose).toHaveBeenCalledTimes(2);expect(f.client.didOpen).toHaveBeenLastCalledWith("oxide://project/a/query.sql","two",1,"sql");await b.release();
  });
  it("does not let a prior process owner close a replacement process document",async()=>{
    const f=fixture(),a=f.acquire();await a.synchronize("old","sql");f.process.setReady(true,true);const b=f.acquire();
    await b.synchronize("new","sql");const closes=f.client.didClose.mock.calls.length;
    await a.release();expect(f.client.didClose).toHaveBeenCalledTimes(closes);
    await b.synchronize("newer","sql");expect(f.client.didChange).toHaveBeenLastCalledWith("oxide://project/a/query.sql","newer",2);await b.release();
  });
  it("rejects old process writes without switching the wire back to the old epoch",async()=>{
    const f=fixture(),a=f.acquire();await a.synchronize("old","sql");f.process.setReady(true,true);const b=f.acquire();await b.synchronize("new","sql");
    await expect(a.synchronize("stale","sql")).rejects.toThrow("process changed");expect(f.client.didOpen).toHaveBeenCalledTimes(2);
    await a.release();await b.release();
  });
  it("orders a held old-process open, release and replacement before assigning fresh versions",async()=>{
    const f=fixture(),gate=deferred(),a=f.acquire();f.client.didOpen.mockImplementationOnce(()=>gate.promise);
    const old=a.synchronize("old","sql");await vi.waitFor(()=>expect(f.client.didOpen).toHaveBeenCalledOnce());
    f.process.setReady(true,true);const closing=a.release(),b=f.acquire(),next=b.synchronize("new","sql");gate.resolve();await Promise.all([old,closing,next]);
    expect(f.client.didClose.mock.invocationCallOrder[0]).toBeLessThan(f.client.didOpen.mock.invocationCallOrder[1]!);
    expect(f.client.didOpen.mock.calls.map(call=>call[2])).toEqual([1,1]);await b.release();
  });
  it("isolates exact URI authorities, session keys and client identities",async()=>{
    const f=fixture(),g=fixture(),owners=[f.acquire(1,"oxide://project/a/same.sql"),f.acquire(1,"oxide://query/a/same.sql"),f.acquire(1,"oxide://project/a/same.sql","other"),g.acquire(1,"oxide://project/a/same.sql")];
    for(const a of owners)await a.synchronize("same","sql");expect(f.client.didOpen).toHaveBeenCalledTimes(3);expect(g.client.didOpen).toHaveBeenCalledOnce();
    await owners[0]!.release();expect(f.client.didClose).toHaveBeenCalledOnce();expect(g.client.didClose).not.toHaveBeenCalled();for(const a of owners.slice(1))await a.release();
  });
  it("reopens on a language transition and keeps the owner usable",async()=>{
    const f=fixture(),a=f.acquire();await a.synchronize("SELECT 1","sql");await a.synchronize("SELECT 1","postgres");
    expect(f.client.didClose).toHaveBeenCalledOnce();expect(f.client.didOpen).toHaveBeenLastCalledWith("oxide://project/a/query.sql","SELECT 1",1,"postgres");await a.release();
  });
  it("keeps one final cleanup callback per Monaco scope across repeated pane mounts",async()=>{
    const f=fixture(),index=f.acquire(0),scope={},cleanup=vi.fn();await index.synchronize("disk","sql");
    for(let i=0;i<12;i++){const pane=acquireLspDocument({client:f.client,uri:"oxide://project/a/query.sql",sessionKey:"session",priority:1,onCloseKey:scope,onClose:()=>cleanup(i)});await pane.synchronize("buffer","sql");await pane.release();}
    expect(cleanup).not.toHaveBeenCalled();await index.release();expect(cleanup).toHaveBeenCalledTimes(1);expect(cleanup).toHaveBeenCalledWith(11);
  });
  it("isolates failed shadow observers from the transport commit and other owners",async()=>{
    const f=fixture(),report=vi.spyOn(console,"error").mockImplementation(()=>{}),peer=vi.fn();
    const a=acquireLspDocument({client:f.client,uri:"uri",sessionKey:"session",priority:1,onShadow:()=>{throw new Error("observer");}}),b=acquireLspDocument({client:f.client,uri:"uri",sessionKey:"session",priority:1,onShadow:peer});
    try{await a.synchronize("value","sql");expect(peer).toHaveBeenCalledWith({text:"value",version:1,languageId:"sql"});expect(report).toHaveBeenCalledOnce();}
    finally{await a.release();await b.release();report.mockRestore();}
  });
});
