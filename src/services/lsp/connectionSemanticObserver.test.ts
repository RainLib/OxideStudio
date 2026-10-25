import {expect,it,vi} from "vitest";
import {createConnectionSemanticStore} from "./connectionSemanticState";
import {createConnectionSemanticObserver,verifyConnectionSemanticObservation} from "./connectionSemanticObserver";
const state=(revision=1)=>({connectionId:"id",session:"11111111-2222-4333-8444-555555555555",revision,
  activeOperations:0,openTransactions:0,connected:true,uncertain:false});
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){const store=createConnectionSemanticStore();let emit!:(value:ReturnType<typeof state>)=>void;
  const unlisten=vi.fn(),get=vi.fn().mockResolvedValue(state()),listen=vi.fn(async fn=>{emit=fn;return unlisten;});
  const observer=createConnectionSemanticObserver(store,{get,listen});return {store,observer,get,listen,unlisten,emit:(value:ReturnType<typeof state>)=>emit(value)};}
it("subscribes before it reads and deduplicates concurrent hydration",async()=>{
  const f=fixture();const a=f.observer.hydrate("id"),b=f.observer.hydrate("id");expect(a).toBe(b);await a;
  expect(f.listen).toHaveBeenCalledOnce();expect(f.get).toHaveBeenCalledOnce();expect(f.store.getState().byConnectionId.id?.status).toBe("ready");f.observer.dispose();
});
it("does not read before an asynchronous subscription is attached",async()=>{
  const store=createConnectionSemanticStore(),sub=deferred<()=>void>(),get=vi.fn().mockResolvedValue(state());
  const observer=createConnectionSemanticObserver(store,{get,listen:()=>sub.promise});const pending=observer.hydrate("id");
  await Promise.resolve();expect(get).not.toHaveBeenCalled();sub.resolve(()=>{});await pending;expect(get).toHaveBeenCalledOnce();observer.dispose();
});
it("does not let late snapshots erase an event received during hydration",async()=>{
  const f=fixture(),reply=deferred<ReturnType<typeof state>>();f.get.mockReturnValue(reply.promise);
  const pending=f.observer.hydrate("id");await vi.waitFor(()=>expect(f.get).toHaveBeenCalledOnce());f.emit(state(3));reply.resolve(state(1));await pending;
  expect(f.store.getState().byConnectionId.id?.state?.revision).toBe(3);f.observer.dispose();
});
it.each(["null","error"])("does not lose a newer event to late %s hydration",async outcome=>{
  const f=fixture(),reply=deferred<ReturnType<typeof state>|null>();f.get.mockReturnValue(reply.promise);
  const pending=f.observer.hydrate("id");await vi.waitFor(()=>expect(f.get).toHaveBeenCalledOnce());f.emit(state(3));
  if(outcome==="null")reply.resolve(null);else reply.reject(new Error("offline"));await pending;
  expect(f.store.getState().byConnectionId.id?.state?.revision).toBe(3);f.observer.dispose();
});
it("disposes a late subscription without applying its snapshot",async()=>{
  const store=createConnectionSemanticStore(),sub=deferred<()=>void>(),unlisten=vi.fn(),get=vi.fn();
  const observer=createConnectionSemanticObserver(store,{get,listen:()=>sub.promise});const pending=observer.hydrate("id");
  observer.dispose();sub.resolve(unlisten);await pending;expect(unlisten).toHaveBeenCalledOnce();expect(get).not.toHaveBeenCalled();
});
it("keeps failed transport unknown instead of granting legacy cache authority",async()=>{
  const store=createConnectionSemanticStore(),observer=createConnectionSemanticObserver(store,{get:vi.fn(),listen:async()=>{throw new Error("offline");}});
  await observer.hydrate("id");expect(store.getState()).toMatchObject({enabled:true,transport:"error"});observer.dispose();
});
it("verifies equal readback without changing its own observation identity",async()=>{
  const f=fixture();await f.observer.hydrate("id");const expected=f.store.getState().byConnectionId.id!;
  expect(await verifyConnectionSemanticObservation("id",expected,f.store,f.get)).toBe(true);
  expect(f.store.getState().byConnectionId.id).toBe(expected);f.observer.dispose();
});
it("rejects a changed host revision even if its event has not arrived",async()=>{
  const f=fixture();await f.observer.hydrate("id");const expected=f.store.getState().byConnectionId.id!;f.get.mockResolvedValue(state(2));
  expect(await verifyConnectionSemanticObservation("id",expected,f.store,f.get)).toBe(false);
  expect(f.store.getState().byConnectionId.id?.state?.revision).toBe(2);f.observer.dispose();
});
it("does not fetch metadata authority while a transaction or local request is active",async()=>{
  const f=fixture();await f.observer.hydrate("id");f.emit({...state(2),openTransactions:1});f.get.mockClear();
  expect(await verifyConnectionSemanticObservation("id",f.store.getState().byConnectionId.id!,f.store,f.get)).toBe(false);
  expect(f.get).not.toHaveBeenCalled();f.observer.dispose();
});
