import {expect,it,vi} from "vitest";
import {acquireSharedModelPublication,refreshSharedModelPublication} from "./sharedModelPublication";

function fixture(){
  const scope={},model={},render=vi.fn();
  const acquire=(options:Partial<Parameters<typeof acquireSharedModelPublication<string[]>>[0]>={})=>acquireSharedModelPublication<string[]>({scope,model,layer:"sql-lsp",render,...options});
  return {scope,model,render,acquire};
}
it("does not clear a surviving publisher on sibling clear or dispose",()=>{
  const f=fixture(),a=f.acquire(),b=f.acquire();a.publish(["a"]);b.publish(["b"]);a.clear();a.dispose();expect(f.render).toHaveBeenLastCalledWith(["b"]);b.dispose();expect(f.render).toHaveBeenLastCalledWith(undefined);
});
it("keeps a compatible existing publication while a new owner waits",()=>{
  const f=fixture(),a=f.acquire();a.publish(["a"]);const b=f.acquire();expect(f.render).toHaveBeenLastCalledWith(["a"]);b.dispose();a.dispose();
});
it("keeps the newest empty result after its publishing pane retires",()=>{
  const f=fixture(),a=f.acquire(),b=f.acquire();a.publish(["old error"]);b.publish([]);b.dispose();expect(f.render).toHaveBeenLastCalledWith([]);a.refresh();expect(f.render).toHaveBeenLastCalledWith([]);a.dispose();
});
it("does not revive a retired publication when the surviving guard rejects its revision",()=>{
  const f=fixture();let current=true;const a=f.acquire({accepts:()=>current}),b=f.acquire({accepts:()=>current});b.publish(["old"]);b.dispose();current=false;a.refresh();expect(f.render).toHaveBeenLastCalledWith(undefined);a.dispose();
});
it("does not borrow diagnostics from a different owner context while waiting",()=>{
  const f=fixture(),a=f.acquire({accepts:value=>value[0]==="a"});a.publish(["a"]);const b=f.acquire({accepts:value=>value[0]==="b"});expect(f.render).toHaveBeenLastCalledWith(undefined);
  b.publish(["b"]);b.dispose();expect(f.render).toHaveBeenLastCalledWith(["a"]);a.dispose();
});
it("gives the focused owner authority and reselects on refresh",()=>{
  const f=fixture();let focused="a";const a=f.acquire({isPreferred:()=>focused==="a",accepts:value=>value[0]==="a"}),b=f.acquire({isPreferred:()=>focused==="b",accepts:value=>value[0]==="b"});
  a.publish(["a"]);b.publish(["b"]);expect(f.render).toHaveBeenLastCalledWith(["a"]);focused="b";a.refresh();expect(f.render).toHaveBeenLastCalledWith(["b"]);a.dispose();b.dispose();
});
it("does not emit another render for an unchanged candidate and leader",()=>{
  const f=fixture(),a=f.acquire();a.publish(["a"]);const count=f.render.mock.calls.length;a.refresh();a.refresh();expect(f.render).toHaveBeenCalledTimes(count);a.dispose();
});
it("ignores late publish/clear and repeated disposal",()=>{
  const f=fixture(),a=f.acquire(),b=f.acquire();a.publish(["a"]);a.dispose();b.publish(["b"]);const count=f.render.mock.calls.length;a.publish(["late"]);a.clear();a.dispose();expect(f.render).toHaveBeenCalledTimes(count);b.dispose();
});
it("isolates Monaco scopes, actual models, and marker layers",()=>{
  const f=fixture(),g=f.acquire(),other=vi.fn(),a=f.acquire({scope:{},render:other}),b=f.acquire({model:{},render:other}),c=f.acquire({layer:"oracle-syntax",render:other});
  g.publish(["global"]);a.publish(["scope"]);b.publish(["model"]);c.publish(["layer"]);expect(f.render).toHaveBeenLastCalledWith(["global"]);a.dispose();b.dispose();c.dispose();g.dispose();
});
it("lets lifecycle cleanup preserve a live publisher and cleans the registry after final disposal",()=>{
  const f=fixture(),a=f.acquire();a.publish(["live"]);expect(refreshSharedModelPublication(f.scope,f.model,"sql-lsp")).toBe(true);expect(f.render).toHaveBeenLastCalledWith(["live"]);
  a.dispose();expect(refreshSharedModelPublication(f.scope,f.model,"sql-lsp")).toBe(false);
});
it("fails a throwing guard closed without leaking the previous result",()=>{
  const f=fixture(),report=vi.spyOn(console,"error").mockImplementation(()=>{}),a=f.acquire();a.publish(["old"]);
  const b=f.acquire({accepts:()=>{throw new Error("guard");}});expect(f.render).toHaveBeenLastCalledWith(undefined);expect(report).toHaveBeenCalled();b.dispose();a.dispose();report.mockRestore();
});
it("retries a failed renderer on the next refresh",()=>{
  const f=fixture(),report=vi.spyOn(console,"error").mockImplementation(()=>{});let failing=false;
  const a=f.acquire({render:value=>{if(failing)throw new Error("renderer");f.render(value);}});failing=true;a.publish(["value"]);failing=false;a.refresh();expect(f.render).toHaveBeenLastCalledWith(["value"]);a.dispose();report.mockRestore();
});
it("updates every distinct observer sink and revokes stale views on a single refresh",()=>{
  const f=fixture(),group={},left=vi.fn(),right=vi.fn();let current=true;
  const a=f.acquire({accepts:()=>current,observer:{group,key:"left",notify:left}}),b=f.acquire({accepts:()=>current,observer:{group,key:"right",notify:right}});
  a.publish(["value"]);expect(left).toHaveBeenLastCalledWith(["value"]);expect(right).toHaveBeenLastCalledWith(["value"]);current=false;a.refresh();expect(left).toHaveBeenLastCalledWith(undefined);expect(right).toHaveBeenLastCalledWith(undefined);a.dispose();b.dispose();
});
it("does not send a clearing update to a sink still owned by a surviving pane",()=>{
  const f=fixture(),group={},notify=vi.fn(),a=f.acquire({observer:{group,key:"same",notify}}),b=f.acquire({observer:{group,key:"same",notify}});
  b.publish(["value"]);notify.mockClear();b.dispose();expect(notify.mock.calls.every(call=>call[0]!==undefined)).toBe(true);expect(notify).toHaveBeenLastCalledWith(["value"]);a.dispose();expect(notify).toHaveBeenLastCalledWith(undefined);
});
it("isolates an observer failure from another tab's update",()=>{
  const f=fixture(),report=vi.spyOn(console,"error").mockImplementation(()=>{}),group={},notify=vi.fn();
  const a=f.acquire({observer:{group,key:"broken",notify:()=>{throw new Error("observer");}}}),b=f.acquire({observer:{group,key:"valid",notify}});
  a.publish(["value"]);expect(notify).toHaveBeenLastCalledWith(["value"]);expect(report).toHaveBeenCalled();a.dispose();b.dispose();report.mockRestore();
});
