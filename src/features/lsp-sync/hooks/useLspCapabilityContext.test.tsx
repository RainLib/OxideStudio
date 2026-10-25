/** @vitest-environment happy-dom */
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import type {ConnectionConfig, ConnectionRuntimeState} from "@/features/connections/model/types";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {useLspCapabilityContext} from "./useLspCapabilityContext";

const mocks=vi.hoisted(()=>({live:vi.fn(),fallback:vi.fn()}));
vi.mock("@/services/tauri",()=>({databaseService:{getConnectionDatabaseCapabilityContext:mocks.live,getDatabaseCapabilities:mocks.fallback}}));
const capabilities=defaultDatabaseCapabilities("postgres");
const connection={id:"same-id",name:"Fixture",driver:"postgres"} as ConnectionConfig;
type Options={activeConnection:ConnectionConfig|undefined;driverCatalogStatus:"ready";activeConnectionRuntime:ConnectionRuntimeState|undefined;semanticSession?:string};
let root:Root,container:HTMLDivElement,result:ReturnType<typeof useLspCapabilityContext>;
const context=(version:string)=>({capabilities,serverVersion:version});
function Probe(props:Options){result=useLspCapabilityContext(props);return null;}
async function render(runtime:ConnectionRuntimeState|undefined,activeConnection:ConnectionConfig|null=connection){
  await act(async()=>{root.render(<Probe activeConnection={activeConnection||undefined} activeConnectionRuntime={runtime} driverCatalogStatus="ready"/>);});
}
beforeEach(()=>{
  vi.clearAllMocks();mocks.live.mockReset();mocks.fallback.mockReset();
  mocks.live.mockResolvedValue(context("16.0"));mocks.fallback.mockResolvedValue(capabilities);
  container=document.createElement("div");root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});

it("resolves a replacement session with the same id and timestamp",async()=>{
  await render({status:"connected",updatedAt:1});
  expect(result.resolvedCapabilityContext?.serverVersion).toBe("16.0");
  mocks.live.mockResolvedValue(context("17.0"));
  await render({status:"connected",updatedAt:1});
  expect(mocks.live).toHaveBeenCalledTimes(2);
  expect(result.resolvedCapabilityContext?.serverVersion).toBe("17.0");
});

it.each(["connecting","idle","error"] as const)("does not introspect an unavailable %s session",async status=>{
  await render({status,updatedAt:1});
  expect(mocks.live).not.toHaveBeenCalled();
  expect(result.resolvedCapabilityContext).toBeNull();
});

it("removes the old context while a reconnect is unresolved",async()=>{
  await render({status:"connected",updatedAt:1});
  let resolve!: (value:ReturnType<typeof context>)=>void;
  mocks.live.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  await render({status:"connected",updatedAt:2});
  expect(result.resolvedCapabilityContext).toBeNull();
  await act(async()=>resolve(context("17.0")));
  expect(result.resolvedCapabilityContext?.serverVersion).toBe("17.0");
});

it("drops a late capability response from the replaced session",async()=>{
  let resolve!: (value:ReturnType<typeof context>)=>void;
  mocks.live.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  await render({status:"connected",updatedAt:1});
  mocks.live.mockResolvedValue(context("17.0"));
  await render({status:"connected",updatedAt:2});
  await act(async()=>resolve(context("old")));
  expect(result.resolvedCapabilityContext?.serverVersion).toBe("17.0");
});

it("does not repeat live requests for unrelated rerenders of the same runtime",async()=>{
  const runtime={status:"connected" as const,updatedAt:1};
  await render(runtime);await render(runtime);
  expect(mocks.live).toHaveBeenCalledTimes(1);
});

it("rechecks capabilities when the host replaces the driver without changing the UI runtime",async()=>{
  const runtime={status:"connected" as const,updatedAt:1};
  const renderSession=async(semanticSession:string)=>act(async()=>{root.render(<Probe activeConnection={connection} activeConnectionRuntime={runtime} driverCatalogStatus="ready" semanticSession={semanticSession}/>);});
  await renderSession("first-driver");
  mocks.live.mockResolvedValue(context("17.0"));
  await renderSession("replacement-driver");
  expect(mocks.live).toHaveBeenCalledTimes(2);
  expect(result.resolvedCapabilityContext?.serverVersion).toBe("17.0");
  await renderSession("replacement-driver");
  expect(mocks.live).toHaveBeenCalledTimes(2);
});

it("preserves callers without a runtime descriptor and clears after deselection",async()=>{
  await render(undefined);expect(result.resolvedCapabilityContext?.serverVersion).toBe("16.0");
  await render(undefined,null);expect(result.resolvedCapabilityContext).toBeNull();
});
