/** @vitest-environment happy-dom */
import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {LspClient} from "@/services/lsp/client/LspClient";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {useLspClient} from "./useLspClient";

const ports=vi.hoisted(()=>({invoke:vi.fn(),ensure:vi.fn(),resolve:vi.fn(),retain:vi.fn(),release:vi.fn(),legacy:null as any}));
vi.mock("@tauri-apps/api/core",()=>({invoke:ports.invoke}));
vi.mock("@/services/lsp",()=>({ensureLspSession:ports.ensure,getLspSessionDescriptor:ports.resolve,retainLspSession:ports.retain,get lspClient(){return ports.legacy;}}));
const capabilities=defaultDatabaseCapabilities("postgres");
let root:Root|null,control:ReturnType<typeof useLspClient>,primary:LspClient,secondary:LspClient;
let descriptor:any,secondDescriptor:any;
const renders:Array<{id:string;ready:boolean}>=[];
const flush=async()=>{for(let index=0;index<20;index++)await Promise.resolve();};
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {resolve,promise};}
function Probe({id="one",enabled=true}:{id?:string;enabled?:boolean}){control=useLspClient({connectionId:id,driver:"postgres",capabilities,enabled});renders.push({id,ready:control.isReady});return null;}
beforeEach(()=>{
  vi.clearAllMocks();vi.useRealTimers();renders.length=0;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  ports.invoke.mockImplementation(async(command:string)=>command==="lsp_is_running"?true:"initialized");
  primary=new LspClient("runtime-one");secondary=new LspClient("runtime-two");ports.legacy=new LspClient("runtime-default");
  descriptor={key:"runtime-one",profile:{languageId:"postgres"},client:primary};secondDescriptor={key:"runtime-two",profile:{languageId:"postgres"},client:secondary};
  ports.resolve.mockImplementation((options:any)=>options.connectionId==="two"?secondDescriptor:descriptor);
  ports.retain.mockReturnValue(ports.release);ports.ensure.mockImplementation(async(options:any)=>{const next=ports.resolve(options);await next.client.initialize("/fixture/sql-lsp");return next;});
  root=createRoot(document.createElement("div"));
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=null;vi.useRealTimers();});
const render=async(id="one",enabled=true)=>act(async()=>{root!.render(<Probe id={id} enabled={enabled}/>);await flush();});

it("starts the retained client and exposes its live process snapshot",async()=>{
  await render();expect(control.isReady).toBe(true);expect(control.runtime).toBe(primary.getRuntimeSnapshot());expect(control.status).toBe("ready");expect(ports.retain).toHaveBeenCalledExactlyOnceWith("runtime-one");
});
it("revokes readiness immediately and recovers without waiting for the health interval",async()=>{
  await render();const recovery=deferred(),old=control.runtime;
  ports.ensure.mockImplementationOnce(async()=>{await recovery.promise;await primary.initialize("/fixture/sql-lsp");return descriptor;});
  await act(async()=>{primary.markDisconnected();await flush();});expect(control.isReady).toBe(false);expect(control.status).toBe("starting");expect(control.runtime).not.toBe(old);expect(ports.ensure).toHaveBeenCalledTimes(2);
  await act(async()=>{recovery.resolve();await flush();});expect(control.isReady).toBe(true);expect(control.runtime.ready).toBe(true);
});
it("observes a quick same-client restart even if readiness is batched",async()=>{
  await render();const before=control.runtime;
  await act(async()=>{primary.markDisconnected();await primary.initialize("/fixture/sql-lsp");await flush();});
  expect(control.isReady).toBe(true);expect(control.runtime).not.toBe(before);expect(control.runtime.generation).not.toBe(before.generation);
});
it("does not recover a released component after unmount",async()=>{
  await render();await act(async()=>root!.unmount());root=null;const calls=ports.ensure.mock.calls.length;primary.markDisconnected();await flush();
  expect(ports.ensure).toHaveBeenCalledTimes(calls);expect(ports.release).toHaveBeenCalledOnce();
});
it("keeps a disabled consumer unready even if the legacy default process is running",async()=>{
  await ports.legacy.initialize("/fixture/sql-lsp");await render("one",false);expect(control.status).toBe("disabled");expect(control.isReady).toBe(false);expect(ports.ensure).not.toHaveBeenCalled();expect(ports.retain).not.toHaveBeenCalled();
});
it("does not expose the old ready state when selecting a different uninitialized client",async()=>{
  await render();const pending=deferred();ports.ensure.mockImplementationOnce(async()=>{await pending.promise;await secondary.initialize("/fixture/sql-lsp");return secondDescriptor;});
  await render("two");expect(control.client).toBe(secondary);expect(control.isReady).toBe(false);expect(renders.filter(value=>value.id==="two").every(value=>!value.ready)).toBe(true);
  await act(async()=>{pending.resolve();await flush();});expect(control.isReady).toBe(true);
});
it("reports startup failures without an immediate retry loop",async()=>{
  ports.ensure.mockRejectedValueOnce(new Error("startup failed"));await render();expect(control.isReady).toBe(false);expect(control.error).toBe("startup failed");expect(control.status).toBe("error");expect(ports.ensure).toHaveBeenCalledOnce();
});
it("coalesces the health callback and runtime-disconnect recovery",async()=>{
  vi.useFakeTimers();await render();ports.invoke.mockResolvedValueOnce(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_000);await flush();});expect(control.isReady).toBe(true);expect(ports.ensure).toHaveBeenCalledTimes(2);
});
it("shares one actual initialize command across two mounted consumers",async()=>{
  const start=deferred<string>();ports.invoke.mockImplementation(async(command:string)=>command==="lsp_initialize"?start.promise:true);
  await act(async()=>{root!.render(<><Probe/><Probe/></>);await flush();});expect(control.isReady).toBe(false);expect(ports.invoke.mock.calls.filter(call=>call[0]==="lsp_initialize")).toHaveLength(1);
  await act(async()=>{start.resolve("initialized");await flush();});expect(control.isReady).toBe(true);
});
it("keeps runtime recovery usable after StrictMode effect recreation",async()=>{
  await act(async()=>{root!.render(<StrictMode><Probe/></StrictMode>);await flush();});expect(control.isReady).toBe(true);
  await act(async()=>{primary.markDisconnected();await flush();});expect(control.isReady).toBe(true);expect(ports.retain.mock.calls.length-ports.release.mock.calls.length).toBe(1);
});

it("clears a previous startup error when an externally repaired process becomes ready",async()=>{
  ports.ensure.mockRejectedValueOnce(new Error("old startup error"));await render();expect(control.error).toBe("old startup error");
  await act(async()=>{await primary.initialize("/fixture/sql-lsp");await flush();});expect(control.isReady).toBe(true);expect(control.status).toBe("ready");expect(control.error).toBeNull();
});
