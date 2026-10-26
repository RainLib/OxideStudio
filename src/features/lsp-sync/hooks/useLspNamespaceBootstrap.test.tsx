// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLspNamespaceBootstrap } from "./useLspNamespaceBootstrap";
let root: Root, container: HTMLDivElement;
type Options = Parameters<typeof useLspNamespaceBootstrap>[0];
function Harness(props: Options) { useLspNamespaceBootstrap(props); return null; }
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const render=async(options:Options)=>act(async()=>root.render(<Harness {...options}/>));
describe("editor namespace bootstrap",()=>{
  const fixture=()=>({connectionId:"managed",projectId:"hs_test",runtime:{status:"connected" as const,updatedAt:1},enabled:true,namespaceCount:0,metadataVersion:0,load:vi.fn().mockResolvedValue(undefined)});
  it("refreshes an empty cached namespace list without an Explorer mount",async()=>{
    const options=fixture();await render(options);
    expect(options.load).toHaveBeenCalledExactlyOnceWith("managed",true);
    await render({...options});expect(options.load).toHaveBeenCalledTimes(1);
  });
  it("retries only for a changed live workspace identity",async()=>{
    const options=fixture();await render(options);
    await render({...options,projectId:"other"});expect(options.load).toHaveBeenCalledTimes(2);
  });
  it.each(["populated","disconnected","disabled"])("keeps %s contexts quiet",async kind=>{
    const options=fixture();await render({...options,namespaceCount:kind==="populated"?1:0,enabled:kind!=="disabled",runtime:kind==="disconnected"?undefined:options.runtime});
    expect(options.load).not.toHaveBeenCalled();
  });
});
