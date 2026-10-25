import {expect,it,vi} from "vitest";
import {DEFAULT_APP_SETTINGS} from "@/lib/appSettings";
import {defaultDatabaseCapabilities} from "@/lib/databaseDialect";
import type {TabData} from "@/features/workspace-tabs/model/types";
import type {FileQueryDocument} from "./model";
import {fileQueryConfiguration} from "./fileQueryConfiguration";
import {createFileQueryAnalysisContext} from "./fileQueryAnalysisContext";
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function fixture(){
  const uri="oxide-file-query://project/file.sql",session={id:"a1e2aab5-77bb-454b-9407-d2741b25241f",projectId:"project",driverId:"sqlite",packageVersion:"0.1.0",csvHeader:"auto" as const,
    fileName:"data.csv",format:"csv" as const,sourceBytes:12,initialSql:"SELECT * FROM data",languageId:"sqlite",capabilities:defaultDatabaseCapabilities("sqlite")};
  const document:FileQueryDocument={source:{kind:"picker",projectId:"project"},session,driverId:"sqlite",packageVersion:"0.1.0",csvHeader:"auto",schema:[{name:"revenue",data_type:"BIGINT"}]};
  let live={id:"file",type:"query",sql:"SELECT private_value FROM data",fileQuery:document} as TabData|undefined,project="project",runtime={ready:true,generation:{}},preferences=true,notify=()=>{};
  const first=deferred(),send=vi.fn().mockImplementationOnce(()=>first.promise).mockResolvedValue(undefined),release=vi.fn();
  const config=fileQueryConfiguration(live!,uri,"sqlite",DEFAULT_APP_SETTINGS.editor.sqlCompletion,DEFAULT_APP_SETTINGS.editor.sqlFormatting);
  const context=createFileQueryAnalysisContext({document,uri,runtime,runtimeReady:true,dialect:"sqlite",config,readTab:()=>live,readProject:()=>project,readRuntime:()=>runtime,
    preferencesCurrent:()=>preferences,subscribeLive:listener=>{notify=listener;return release;},updateConfiguration:send,confirmConfiguration:vi.fn().mockResolvedValue(true)});
  context.start();
  return {context,send,first,config,release,document,session,readLive:()=>live,
    change:(action:"session"|"schema"|"source"|"driver"|"package"|"header"|"close"|"project"|"runtime"|"preferences")=>{
      if(action==="close")live=undefined;
      else if(action==="project")project="other";
      else if(action==="runtime")runtime={ready:true,generation:{}};
      else if(action==="preferences")preferences=false;
      else {const doc=live!.fileQuery!;live={...live!,fileQuery:{...doc,...(action==="session"?{session:{...session}}:action==="schema"?{schema:[{name:"other",data_type:"TEXT"}]}:
        action==="source"?{source:{kind:"picker" as const,projectId:"project"}}:action==="driver"?{driverId:"postgres"}:action==="package"?{packageVersion:"0.2.0"}:{csvHeader:"absent" as const})}};}
      notify();
    },irrelevant:()=>{live={...live!,sql:"SELECT 2",results:[]};notify();},restore:()=>{live={id:"file",type:"query",sql:"SELECT 1",fileQuery:document} as TabData;project="project";preferences=true;notify();}};
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
it("grants exactly the acknowledged file configuration token",async()=>{
  const f=fixture();expect(f.context.isReady()).toBe(false);expect(f.context.read()).toMatchObject({available:true,syntaxAllowed:true,lspAllowed:false,metadataAllowed:false});
  f.first.resolve();await flush();expect(f.context.isReady()).toBe(true);expect(f.context.read().analysisToken).toBe(f.send.mock.calls[0]![0].oxideAnalysisToken);f.context.dispose();
});
it.each(["session","schema","source","driver","package","header","close","project","runtime","preferences"] as const)("rejects a late acknowledgement after %s changes",async action=>{
  const f=fixture();f.change(action);f.first.resolve();await flush();expect(f.context.isReady()).toBe(false);expect(f.context.read().analysisToken).toBeUndefined();f.context.dispose();
});
it.each(["session","schema","close","project","runtime"] as const)("withdraws an existing grant synchronously on %s",async action=>{
  const f=fixture();f.first.resolve();await flush();expect(f.context.isReady()).toBe(true);const listener=vi.fn();f.context.subscribe(listener);f.change(action);
  expect(f.context.read().metadataAllowed).toBe(false);expect(listener).toHaveBeenCalledOnce();f.context.dispose();
});
it("does not resend configuration for ordinary SQL/results updates",async()=>{
  const f=fixture();f.first.resolve();await flush();const before=f.context.read();for(let i=0;i<40;i++)f.irrelevant();expect(f.context.read()).toEqual(before);expect(f.send).toHaveBeenCalledOnce();f.context.dispose();
});
it("does not regain a stale grant when an old session object reappears",async()=>{
  const f=fixture();f.first.resolve();await flush();const old=f.context.read().analysisToken;f.change("session");f.restore();expect(f.context.read().metadataAllowed).toBe(false);await flush();
  expect(f.send).toHaveBeenCalledTimes(2);expect(f.context.read().analysisToken).not.toBe(old);f.context.dispose();
});
it("supports StrictMode cleanup/restart while refusing the first mount's late send",async()=>{
  const f=fixture();const second=deferred();f.send.mockImplementationOnce(()=>second.promise);f.context.dispose();f.context.start();f.first.resolve();await flush();expect(f.context.isReady()).toBe(false);
  second.resolve();await flush();expect(f.context.isReady()).toBe(true);expect(f.context.read().analysisToken).toBe(f.send.mock.calls[1]![0].oxideAnalysisToken);f.context.dispose();
});
it("keeps transport failure unready and releases live subscriptions",async()=>{
  const f=fixture();f.first.resolve();await flush();f.send.mockRejectedValueOnce(new Error("configuration failed"));f.change("schema");f.restore();await flush();expect(f.context.getSnapshot()).toEqual({ready:false,error:"configuration failed"});f.context.dispose();expect(f.release).toHaveBeenCalledOnce();
});
it("uses a view UUID, real formatting preferences and no SQL or local file path in configuration",()=>{
  const f=fixture();expect(f.config.schemas[0]!.id).toBe(f.session.id);expect(f.config.schemas[0]!.tables[0]!.columns[0]).toMatchObject({name:"revenue",data_type:"BIGINT"});
  expect(f.config.formattingPreferences.keywordCase).toBe(DEFAULT_APP_SETTINGS.editor.sqlFormatting.keywordCase);expect(JSON.stringify(f.config)).not.toContain("private_value");expect(f.config.schemas[0]!.source_uri).toBeNull();f.context.dispose();
});

it("keeps completion casing separate from formatting casing",()=>{
  const f=fixture(),tab=f.readLive()!,config=fileQueryConfiguration(tab,"oxide-file-query://project/preferences.sql","sqlite",{...DEFAULT_APP_SETTINGS.editor.sqlCompletion,keywordCase:"lower",functionCase:"lower"},{...DEFAULT_APP_SETTINGS.editor.sqlFormatting,keywordCase:"upper",functionCase:"upper"});
  expect(config.completionPreferences).toMatchObject({keywordCase:"lower",functionCase:"lower"});expect(config.formattingPreferences).toMatchObject({keywordCase:"upper",functionCase:"upper"});f.context.dispose();
});
