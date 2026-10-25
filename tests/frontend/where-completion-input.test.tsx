/** @vitest-environment happy-dom */
import {act,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {WhereCompletionInput} from "@/components/workspace/WhereCompletionInput";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import {semanticConnectionToken,semanticTabRoute} from "@/services/lsp/semanticContext";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import {getLspDocumentUri} from "@/services/lsp/document";
const fixture=vi.hoisted(()=>{
 const generation={},runtime={generation,ready:true};
 return {runtime,client:{didOpen:vi.fn().mockResolvedValue(undefined),didChange:vi.fn().mockResolvedValue(undefined),didClose:vi.fn().mockResolvedValue(undefined),getCompletions:vi.fn(),getDocumentCompletions:vi.fn().mockResolvedValue({items:[]}),getRuntimeSnapshot:()=>runtime,subscribeRuntime:()=>()=>{}}};
});
vi.mock("@/services/tauri/schema/catalog",()=>({getColumns:vi.fn().mockResolvedValue([])}));
vi.mock("@/services/tauri/schema/relations",()=>({getDatabaseColumns:vi.fn().mockResolvedValue([])}));
vi.mock("@/hooks/useLspClient",()=>({useLspClient:()=>({isReady:true,client:fixture.client,sessionKey:"where-test",runtime:fixture.runtime})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement,resolve:(items:any[])=>void;
const connection={id:"where",driver:"postgres",name:"where"} as any;
const tab={id:"table",type:"table",connectionId:"where",databaseName:"db",schemaName:"app",tableName:"users"};
const runtime={status:"connected",updatedAt:1} as const;
const props={value:"ex",onChange:vi.fn(),connectionId:"where",driver:"postgres" as const,capabilities:defaultDatabaseCapabilities("postgres"),tabId:"table",databaseName:"db",schemaName:"app",tableName:"users"};
const input=()=>container.querySelector("input")!;
async function trigger(){await act(async()=>{input().focus();input().setSelectionRange(2,2);input().dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,bubbles:true}));await Promise.resolve();});}
beforeEach(async()=>{
 vi.clearAllMocks();props.onChange.mockReset();
 fixture.client.getCompletions.mockImplementation(()=>new Promise<any[]>(done=>{resolve=done;}));
 useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});
 useConnectionStore.setState({connections:[connection],activeConnectionId:"where",connectionRuntimeStates:{where:runtime}});
 useSchemaStore.setState({metadataVersion:1,currentSchema:"app"});useProjectStore.setState({activeProjectId:"project"});useTabStore.setState({tabs:[tab as any]});
 useLspSemanticStatusStore.setState({byConnectionId:{where:{state:"full",totalObjects:1,cacheHits:0,cacheMisses:1,failedObjects:0,updatedAt:1,context:{identity:{connection:semanticConnectionToken(connection),runtime,lspRuntime:fixture.runtime.generation,metadataVersion:1,projectId:"project",currentSchema:"app",routes:{table:semanticTabRoute(tab)}},analysisToken:"valid",sourcesReady:true,metadataReady:true}}}});
 container=document.createElement("div");document.body.append(container);root=createRoot(container);
 await act(async()=>{root.render(<WhereCompletionInput {...props}/>);});
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
it("owns a distinct document and never opens or closes the main query URI",async()=>{
 await trigger();const uri=fixture.client.didOpen.mock.calls[0]?.[0];expect(uri).toBeTruthy();expect(uri).not.toBe(getLspDocumentUri("table","postgres","postgres"));
 await act(async()=>resolve([]));await act(async()=>root.unmount());root=createRoot(container);
 expect(fixture.client.didClose).not.toHaveBeenCalledWith(getLspDocumentUri("table","postgres","postgres"));
});
it("Escape cancels an in-flight list even before the first candidates arrive",async()=>{
 await trigger();await act(async()=>{input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));resolve([{label:"expired_field",insertText:"expired_field"}]);});
 expect(container.textContent).not.toContain("expired_field");
});
it("rejects a late physical completion immediately after metadata changes",async()=>{
 await trigger();await act(async()=>{useSchemaStore.setState({metadataVersion:2});resolve([{label:"expired_field",insertText:"expired_field"}]);});
 expect(container.textContent).not.toContain("expired_field");
});
it("hides a revoked list synchronously before React commits and restores only fresh content",async()=>{
 await trigger();await act(async()=>resolve([{label:"expired_field",insertText:"expired_field"}]));const list=container.querySelector<HTMLElement>("[role=listbox]")!;
 const previous=useLspSemanticStatusStore.getState().byConnectionId.where!;
 await act(async()=>{useLspSemanticStatusStore.setState({byConnectionId:{}});expect(list.hidden).toBe(true);expect(input().getAttribute("aria-expanded")).toBe("false");expect(input().getAttribute("aria-activedescendant")).toBeNull();});
 await act(async()=>{useLspSemanticStatusStore.getState().setStatus("where",{...previous,context:{...previous.context!,analysisToken:"renewed"}});});await trigger();
 await act(async()=>resolve([{label:"fresh_field",insertText:"fresh_field"}]));expect(container.querySelector<HTMLElement>("[role=listbox]")?.hidden).toBe(false);expect(input().getAttribute("aria-expanded")).toBe("true");expect(container.textContent).toContain("fresh_field");expect(container.textContent).not.toContain("expired_field");
});
it.each(["project","runtime","receipt","metadata","table"])("withdraws a displayed list and rejects same-event stale acceptance after %s changes",async change=>{
 await trigger();await act(async()=>resolve([{label:"expired_field",insertText:"expired_field"}]));
 const option=container.querySelector<HTMLButtonElement>("[role=option]")!;expect(option).not.toBeNull();
 await act(async()=>{
  if(change==="project")useProjectStore.setState({activeProjectId:"other"});
  if(change==="runtime")useConnectionStore.setState({connectionRuntimeStates:{where:{status:"connected",updatedAt:1}}});
  if(change==="receipt")useLspSemanticStatusStore.setState({byConnectionId:{}});
  if(change==="metadata")useSchemaStore.setState({metadataVersion:2});
  if(change==="table")useTabStore.setState({tabs:[{...tab,tableName:"other"} as any]});
  option.click();
 });
 expect(props.onChange).not.toHaveBeenCalled();expect(container.textContent).not.toContain("expired_field");
});
it("blur rejects an outstanding result without another keystroke",async()=>{
 await trigger();await act(async()=>{input().blur();resolve([{label:"expired_field",insertText:"expired_field"}]);});expect(container.textContent).not.toContain("expired_field");
});
it("an external condition replacement cancels an outstanding interaction",async()=>{
 await trigger();const reply=resolve;await act(async()=>{root.render(<WhereCompletionInput {...props} value="different"/>);});
 await act(async()=>reply([{label:"expired_field",insertText:"expired_field"}]));expect(container.textContent).not.toContain("expired_field");
});
it("preserves literal dollar arguments in a plain LSP insertion",async()=>{
 await trigger();await act(async()=>resolve([{label:"expression",insertText:"coalesce($1, 0)",insertTextFormat:1}]));
 await act(async()=>container.querySelector<HTMLButtonElement>("[role=option]")!.click());expect(props.onChange).toHaveBeenCalledWith("coalesce($1, 0)");
});
it.each(["escape","external"])("does not let an accepted candidate's old animation frame override a later %s interaction",async action=>{
 let frame:FrameRequestCallback|undefined,setExternal:(value:string)=>void=()=>{};
 vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{frame=callback;return 1;});
 function Controlled(){const [value,setValue]=useState("ex");setExternal=setValue;return <WhereCompletionInput {...props} value={value} onChange={setValue}/>;}
 await act(async()=>root.render(<Controlled/>));await trigger();await act(async()=>resolve([{label:"alpha",insertText:"alpha"}]));
 await act(async()=>container.querySelector<HTMLButtonElement>("[role=option]")!.click());expect(input().value).toBe("alpha");expect(frame).toBeDefined();
 if(action==="external")await act(async()=>setExternal("other"));
 input().setSelectionRange(2,2);
 if(action==="escape")await act(async()=>input().dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
 await act(async()=>frame!(performance.now()));expect(input().selectionStart).toBe(2);expect(fixture.client.getCompletions).toHaveBeenCalledOnce();
});
