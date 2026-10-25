import {expect, it, vi} from "vitest";
import {updateLspConfiguration} from "./documents";
import type {LspClientBridge} from "./contracts";

function fixture() {
  const invoke=vi.fn().mockResolvedValue("ok");
  const initialized=vi.fn(()=>true);
  const bridge={invoke,isInitialized:initialized,commandSessionPayload:()=>({sessionKey:"fixture"})} as unknown as LspClientBridge;
  return {invoke,initialized,bridge};
}
const configuration=(name:string)=>({defaultDialect:"sqlserver",schemas:name?[{id:name,tables:[],functions:[]}]:[],fileSchemas:{},fileDialects:{}});
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}

it("orders replacement metadata behind the reset and an earlier pending transport",async()=>{
  const f=fixture();let finish!:()=>void;
  f.invoke.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const old=updateLspConfiguration(f.bridge,configuration("old"));
  const reset=updateLspConfiguration(f.bridge,configuration(""));
  const fresh=updateLspConfiguration(f.bridge,configuration("fresh"));
  expect(f.invoke).toHaveBeenCalledTimes(1);
  finish();await Promise.all([old,reset,fresh]);
  expect(f.invoke.mock.calls.map(call=>call[1].settings.schemas.map((schema:{id:string})=>schema.id))).toEqual([["old"],[],["fresh"]]);
});

it("allows a reset to recover after an older configuration transport failed",async()=>{
  const f=fixture();let reject!: (error:Error)=>void;
  f.invoke.mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=fail;}));
  const old=updateLspConfiguration(f.bridge,configuration("old"));
  const rejected=expect(old).rejects.toThrow("old transport");
  const reset=updateLspConfiguration(f.bridge,configuration(""));
  reject(new Error("old transport"));await rejected;await reset;
  expect(f.invoke).toHaveBeenCalledTimes(2);
});

it("does not block independent connection sessions behind a slow transport",async()=>{
  const a=fixture(),b=fixture();let finish!:()=>void;
  a.invoke.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const slow=updateLspConfiguration(a.bridge,configuration("a"));
  await updateLspConfiguration(b.bridge,configuration("b"));
  expect(b.invoke).toHaveBeenCalledTimes(1);finish();await slow;
});

it("checks initialization again before a queued send reaches a stopped process",async()=>{
  const f=fixture();let finish!:()=>void;
  f.invoke.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const old=updateLspConfiguration(f.bridge,configuration("old"));
  const queued=updateLspConfiguration(f.bridge,configuration("fresh"));
  f.initialized.mockReturnValue(false);finish();await Promise.all([old,queued]);
  expect(f.invoke).toHaveBeenCalledTimes(1);
});

it("releases a completed queue and propagates its own reset failure",async()=>{
  const f=fixture();await updateLspConfiguration(f.bridge,configuration("old"));await flush();
  f.invoke.mockRejectedValueOnce(new Error("reset failed"));
  await expect(updateLspConfiguration(f.bridge,configuration(""))).rejects.toThrow("reset failed");
  await updateLspConfiguration(f.bridge,configuration("fresh"));
  expect(f.invoke).toHaveBeenCalledTimes(3);
});
