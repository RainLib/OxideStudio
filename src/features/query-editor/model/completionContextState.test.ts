/** @vitest-environment happy-dom */
import {beforeEach,expect,it} from "vitest";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {createLspRuntimeObservation} from "@/services/lsp/client/runtimeObservation";
import {createCompletionContextReader,subscribeCompletionContext} from "./completionContextState";
import {captureCompletionContext,semanticConnectionToken,semanticTabRoute,type LspSemanticContextIdentity} from "@/services/lsp/semanticContext";
import type {ConnectionConfig} from "@/features/connections/model/types";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";

const connection={id:"same",name:"fixture",driver:"postgres",url:"fixture://secret"} as ConnectionConfig;
const runtime={status:"connected" as const,updatedAt:1};
const tab={id:"q",type:"query",connectionId:"same",databaseName:"db",targetSchema:"app"};
let identity:LspSemanticContextIdentity;
let process:ReturnType<typeof createLspRuntimeObservation>;
const processClient={getRuntimeSnapshot:()=>process.getSnapshot()};
const publish=(sourcesReady=true,metadataReady=true)=>useLspSemanticStatusStore.getState().setStatus("same",{
  state:metadataReady?"full":"syncing",totalObjects:1,cacheHits:0,cacheMisses:0,failedObjects:0,context:{identity,analysisToken:"confirmed-token",sourcesReady,metadataReady}});
const read=()=>createCompletionContextReader({connectionId:"same",tabId:"q",connection,lspClient:processClient,metadataVersion:1,projectId:"p",currentSchema:"app",route:semanticTabRoute(tab)});
beforeEach(()=>{
  process=createLspRuntimeObservation();process.setReady(true);
  useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});
  useConnectionStore.setState({connections:[connection],activeConnectionId:"same",connectionRuntimeStates:{same:runtime}});
  useSchemaStore.setState({metadataVersion:1,currentSchema:"app"});useProjectStore.setState({activeProjectId:"p"});
  useTabStore.setState({tabs:[tab as any]});useLspSemanticStatusStore.setState({byConnectionId:{}});
  identity={connection:semanticConnectionToken(connection),runtime,lspRuntime:process.getSnapshot().generation,metadataVersion:1,projectId:"p",currentSchema:"app",routes:{q:semanticTabRoute(tab)}};
});
it("blocks a known session until provenance matches, then separates LSP and physical readiness",()=>{
  const get=read();expect(get()).toMatchObject({available:true,lspAllowed:false,metadataAllowed:false});
  publish(true,false);expect(get()).toMatchObject({lspAllowed:true,metadataAllowed:false});
  publish();expect(get()).toMatchObject({lspAllowed:true,metadataAllowed:true});
  expect(JSON.stringify(identity)).not.toContain("secret");
});
it("invalidates immediately before React renders for a same-id same-timestamp session",()=>{
  publish();const request=captureCompletionContext(read());
  useConnectionStore.setState({connectionRuntimeStates:{same:{status:"connected",updatedAt:1}}});
  expect(request.isCurrent()).toBe(false);expect(read()()).toMatchObject({lspAllowed:false,metadataAllowed:false});
});
it.each(["metadata","route","project","connection"])("rejects the old context after %s changes",key=>{
  publish();const request=captureCompletionContext(read());
  if(key==="metadata")useSchemaStore.setState({metadataVersion:2});
  if(key==="route")useTabStore.setState({tabs:[{...tab,targetSchema:"other"} as any]});
  if(key==="project")useProjectStore.setState({activeProjectId:"other"});
  if(key==="connection")useConnectionStore.setState({connections:[{...connection}]});
  expect(request.isCurrent()).toBe(false);expect(read()().available).toBe(false);
});
it("does not fabricate legacy metadata proof when runtime/provenance are absent",()=>{
  useConnectionStore.setState({connectionRuntimeStates:{}});const get=read(),request=captureCompletionContext(get);
  expect(get()).toMatchObject({lspAllowed:false,metadataAllowed:false});
  useConnectionStore.setState({isLoading:true});expect(request.isCurrent()).toBe(true);
});
it("revokes old completion authority before local IPC and cannot reuse it after release",()=>{
  const owner={};const authority=useConnectionSemanticStore.getState();authority.claim(owner);authority.listening(owner);
  authority.accept(owner,{connectionId:"same",session:"session",revision:1,activeOperations:0,openTransactions:0,connected:true,uncertain:false});
  identity={...identity,execution:useConnectionSemanticStore.getState().byConnectionId.same};publish();
  const get=read(),request=captureCompletionContext(get);expect(get().metadataAllowed).toBe(true);
  const release=authority.beginLocal("same");expect(request.isCurrent()).toBe(false);expect(get()).toMatchObject({available:true,lspAllowed:false,metadataAllowed:false});
  release();expect(get().available).toBe(true);expect(get().metadataAllowed).toBe(false);
  expect(useSchemaStore.getState().metadataVersion).toBe(1);
});
it.each([{activeOperations:1},{openTransactions:1},{uncertain:true},{connected:false}])("holds cache authority while observed host state is %o",patch=>{
  const owner={},authority=useConnectionSemanticStore.getState();authority.claim(owner);authority.listening(owner);
  authority.accept(owner,{connectionId:"same",session:"session",revision:2,activeOperations:0,openTransactions:0,connected:true,uncertain:false,...patch});
  identity={...identity,execution:useConnectionSemanticStore.getState().byConnectionId.same};publish();
  expect(read()()).toMatchObject({available:!("connected" in patch),lspAllowed:false,metadataAllowed:false});
});

it("revokes pending work synchronously on LSP disconnect while preserving document syntax",()=>{
  publish();const get=read(),request=captureCompletionContext(get);process.setReady(false);
  expect(request.isCurrent()).toBe(false);expect(get()).toMatchObject({available:true,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,analysisToken:undefined});
});
it("rejects a quick restart even when no intermediate React render occurs",()=>{
  publish();const get=read(),request=captureCompletionContext(get);process.setReady(false);process.setReady(true);
  expect(request.isCurrent()).toBe(false);expect(get().lspAllowed).toBe(false);expect(get().metadataAllowed).toBe(false);
});
it("requires new configuration provenance for the replacement process",()=>{
  publish();const get=read();process.setReady(false);process.setReady(true);expect(get().metadataAllowed).toBe(false);
  identity={...identity,lspRuntime:process.getSnapshot().generation};publish();expect(get()).toMatchObject({lspAllowed:true,metadataAllowed:true,analysisToken:"confirmed-token"});
});
it("does not accept a late old-process publication after restart",()=>{
  const old=identity;process.setReady(false);process.setReady(true);identity={...identity,lspRuntime:process.getSnapshot().generation};publish();const get=read();expect(get().metadataAllowed).toBe(true);
  identity=old;publish();expect(get().metadataAllowed).toBe(false);expect(get().analysisToken).toBeUndefined();
});
it.each([undefined,"","bad token","x".repeat(129)])("does not grant a ready status without a valid configuration receipt: %s",analysisToken=>{
  publish();useLspSemanticStatusStore.setState(state=>({byConnectionId:{same:{...state.byConnectionId.same!,context:{identity,sourcesReady:true,metadataReady:true,analysisToken}}}}));
  expect(read()()).toMatchObject({available:true,lspAllowed:false,metadataAllowed:false,analysisToken:undefined});
});
it("requires a process identity even when legacy status fields otherwise match",()=>{
  identity={...identity,lspRuntime:undefined};publish();expect(read()()).toMatchObject({lspAllowed:false,metadataAllowed:false});
});
it("ignores unchanged healthy process observations and unrelated store writes",()=>{
  publish();const get=read(),request=captureCompletionContext(get),before=process.getSnapshot();process.setReady(true);useConnectionStore.setState({isLoading:true});
  expect(process.getSnapshot()).toBe(before);expect(request.isCurrent()).toBe(true);expect(get().metadataAllowed).toBe(true);
});
it("withdraws a global fallback connection even when the tab route is unchanged",()=>{
  const fallback={...tab,connectionId:undefined};useTabStore.setState({tabs:[fallback as any]});identity={...identity,routes:{q:semanticTabRoute(fallback)}};publish();
  const get=createCompletionContextReader({connectionId:"same",tabId:"q",connection,lspClient:processClient,metadataVersion:1,projectId:"p",currentSchema:"app",route:semanticTabRoute(fallback)}),request=captureCompletionContext(get);
  expect(get().metadataAllowed).toBe(true);useConnectionStore.setState({activeConnectionId:null});expect(request.isCurrent()).toBe(false);expect(get()).toMatchObject({available:false,lspAllowed:false,metadataAllowed:false});
});
it("keeps an explicitly pinned tab independent from global connection selection",()=>{
  publish();const get=read(),request=captureCompletionContext(get);useConnectionStore.setState({activeConnectionId:"other"});expect(request.isCurrent()).toBe(true);expect(get().metadataAllowed).toBe(true);
});
function localRead(){
  const local={...tab,connectionId:undefined};useTabStore.setState({tabs:[local as any]});useConnectionStore.setState({activeConnectionId:null});
  return createCompletionContextReader({connectionId:null,tabId:"q",connection:undefined,lspClient:processClient,metadataVersion:1,projectId:"p",currentSchema:"app",route:semanticTabRoute(local)});
}
it("grants connectionless document-only context without borrowing old physical status",()=>{
  publish();const get=localRead();expect(get()).toMatchObject({available:true,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false,metadataVersion:0});expect(get().analysisToken).toBeUndefined();
});
it("keeps local declarations independent from unrelated database metadata and processes",()=>{
  const get=localRead(),request=captureCompletionContext(get);useSchemaStore.setState({metadataVersion:9,currentSchema:"other"});process.setReady(false);process.setReady(true);
  expect(request.isCurrent()).toBe(true);expect(get().metadataAllowed).toBe(false);
});
it("revokes a connectionless request immediately when a global connection is assigned",()=>{
  const get=localRead(),request=captureCompletionContext(get);useConnectionStore.setState({activeConnectionId:"same"});expect(request.isCurrent()).toBe(false);expect(get().available).toBe(false);
});
it.each(["project","route","close"])("revokes a local request when its %s changes",reason=>{
  const get=localRead(),request=captureCompletionContext(get);
  if(reason==="project")useProjectStore.setState({activeProjectId:"other"});else if(reason==="close")useTabStore.setState({tabs:[]});else useTabStore.setState(state=>({tabs:state.tabs.map(tab=>({...tab,targetSchema:"different"}))}));
  expect(request.isCurrent()).toBe(false);expect(get().syntaxAllowed).toBe(false);
});
it("subscribes to runtime revocation and releases that subscription",()=>{
  let calls=0;const release=subscribeCompletionContext(()=>calls++,{subscribeRuntime:process.subscribe});process.setReady(false);expect(calls).toBe(1);release();process.setReady(true);expect(calls).toBe(1);
});
