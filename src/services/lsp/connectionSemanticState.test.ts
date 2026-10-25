import {expect,it} from "vitest";
import {createConnectionSemanticStore,isSemanticObservationIdle} from "./connectionSemanticState";
const state=(revision=1)=>({connectionId:"id",session:"11111111-2222-4333-8444-555555555555",revision,
  activeOperations:0,openTransactions:0,connected:true,uncertain:false});
function fixture(){const store=createConnectionSemanticStore(),owner={};store.getState().claim(owner);store.getState().listening(owner);return {store,owner,api:store.getState()};}
it("requires an actual idle snapshot before granting metadata authority",()=>{
  const f=fixture();const reading=f.api.beginRead(f.owner,"id");expect(isSemanticObservationIdle(reading)).toBe(false);
  f.api.accept(f.owner,state());expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(true);
});
it("retains identity for duplicate events and readbacks",()=>{
  const f=fixture();f.api.accept(f.owner,state());const before=f.store.getState().byConnectionId.id;
  f.api.accept(f.owner,state());f.api.accept(f.owner,state(),"snapshot");expect(f.store.getState().byConnectionId.id).toBe(before);
});
it("rejects older revisions even from an old same-id session",()=>{
  const f=fixture();f.api.accept(f.owner,{...state(5),session:"new"});const before=f.store.getState().byConnectionId.id;
  f.api.accept(f.owner,state(4));expect(f.store.getState().byConnectionId.id).toBe(before);
});
it("fails closed on conflicting duplicate events until authoritative readback",()=>{
  const f=fixture();f.api.accept(f.owner,state());f.api.accept(f.owner,{...state(),activeOperations:1});
  expect(f.store.getState().byConnectionId.id?.status).toBe("error");f.api.accept(f.owner,state());
  expect(f.store.getState().byConnectionId.id?.status).toBe("error");f.api.accept(f.owner,state(),"snapshot");
  expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(true);
});
it("does not overwrite a newer event with a late null or failed read",()=>{
  const f=fixture();const before=f.api.beginRead(f.owner,"id")!;f.api.accept(f.owner,state(2));
  f.api.readFailure(f.owner,"id",before,"ready");f.api.readFailure(f.owner,"id",before,"error");
  expect(f.store.getState().byConnectionId.id?.state?.revision).toBe(2);
});
it("isolates connections instead of advancing a global metadata version",()=>{
  const f=fixture();f.api.accept(f.owner,state());const before=f.store.getState().byConnectionId.id;
  f.api.accept(f.owner,{...state(2),connectionId:"other"});expect(f.store.getState().byConnectionId.id).toBe(before);
});
it("tracks overlapping local IPC spans and makes each release idempotent",()=>{
  const f=fixture();f.api.accept(f.owner,state());const a=f.api.beginLocal("id"),b=f.api.beginLocal("id");
  expect(f.store.getState().byConnectionId.id?.localOperations).toBe(2);a();a();
  expect(f.store.getState().byConnectionId.id?.localOperations).toBe(1);b();
  expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(true);
});
it("does not let an old observer revoke its replacement or lose pending client spans",()=>{
  const f=fixture();f.api.accept(f.owner,state());const release=f.api.beginLocal("id"),next={};
  f.api.claim(next);f.api.listening(next);f.api.accept(next,state(2));f.api.stop(f.owner);
  expect(f.store.getState().transport).toBe("ready");expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(false);
  release();expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(true);
});
it.each([{activeOperations:1},{openTransactions:1},{uncertain:true},{connected:false}])("does not grant authority for host state %o",patch=>{
  const f=fixture();f.api.accept(f.owner,{...state(),...patch});expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(false);
});
it("stays closed after transport disposal and keeps missing sessions unknown",()=>{
  const f=fixture();const read=f.api.beginRead(f.owner,"id")!;f.api.readFailure(f.owner,"id",read,"ready");
  expect(isSemanticObservationIdle(f.store.getState().byConnectionId.id)).toBe(false);f.api.stop(f.owner);f.api.accept(f.owner,state());
  expect(f.store.getState().transport).toBe("error");expect(f.store.getState().enabled).toBe(true);
});
