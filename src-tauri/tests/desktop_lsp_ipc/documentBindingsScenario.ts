import { listen } from "@tauri-apps/api/event";
import type * as Monaco from "monaco-editor";
import type { LspClient } from "@/services/lsp/client/LspClient";
import { registerLspCoreProviders } from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import "monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsContribution.js";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;client:LspClient;check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>;restoreConfiguration:()=>Promise<void>};
export async function runDocumentBindingsAcceptance(environment:Environment){
  const {monaco,editor,client,step}=environment;const check:Environment["check"]=environment.check;
  const uri="oxide://desktop/document-bindings.sql",id="aaaaaaaa-1111-4111-8111-111111111111";
  const original=editor.getModel(),model=monaco.editor.createModel("","sql",monaco.Uri.parse(uri));
  let opened=false,core:ReturnType<typeof registerLspCoreProviders>|undefined;
  let publication:{version:number;diagnostics:Array<{code?:string|number;message:string}>}|undefined;
  const unlisten=await listen<{sessionKey?:string;method:string;params:any}>("lsp-notification",event=>{const value=event.payload;if(value.sessionKey===client.getSessionKey()&&value.method==="textDocument/publishDiagnostics"&&value.params.uri===uri)publication=value.params;});
  const receipt={productionCoreProviders:false,renderedInlays:false,renderedInlayRefresh:false,inlayRefreshMilliseconds:[] as number[],protocolRefresh:false,diagnosticRefresh:false,visibleWindowTested:false,inlayPerformanceSamples:[] as Array<{targets:number;repetitions:number;rounds:number;warmup:number;hints:number;milliseconds:number[];p50Milliseconds:number;p95Milliseconds:number}>};
  const configuration=(column="other_value",targets=0)=>{
    const table=(name:string,column:string)=>({name,columns:[{name:column,data_type:"int",nullable:false}]});
    return {schemas:[
      {id,catalog:"db",database:"app",tables:[table("ledger","local_value"),table("collision","shared")],functions:[]},
      {id:"bbbbbbbb-2222-4222-8222-222222222222",catalog:"other",database:"app",tables:targets?Array.from({length:targets},(_,i)=>table(`t${i}`,`c${i}`)):[table("ledger",column),table("collision",column==="other_value"?"shared":"distinct")],functions:[]},
      {id:"cccccccc-3333-4333-8333-333333333333",catalog:"db",database:"sales",tables:[table("ledger","sales_value")],functions:[]},
      {id:"dddddddd-4444-4444-8444-444444444444",server:"remote",catalog:"db",database:"app",tables:[table("ledger","remote_value")],functions:[]},
    ],fileSchemas:{[uri]:id},fileDialects:{[uri]:"sqlserver"}};
  };
  const waitDiagnostics=async()=>{
    const version=model.getVersionId(),deadline=Date.now()+10000;
    while(publication?.version!==version&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    check(publication?.version===version,"document source diagnostics publication matches current version");
    check(!publication.diagnostics.some(d=>d.code==="PARSE_ERROR"),"document source fixtures parse");
    return publication;
  };
  const configure=async(column="other_value",targets=0)=>{publication=undefined;await client.updateConfiguration(configuration(column,targets));if(opened)await waitDiagnostics();};
  const synchronize=async(sql:string)=>{
    model.setValue(sql);publication=undefined;
    if(opened)await client.didChange(uri,model.getValue(),model.getVersionId());else{await client.didOpen(uri,model.getValue(),model.getVersionId(),"mysql");opened=true;}
    return await waitDiagnostics();
  };
  const rawHints=async()=>{const range=model.getFullModelRange();return await client.getInlayHints(uri,{start:{line:0,character:0},end:{line:range.endLineNumber-1,character:range.endColumn-1}});};
  const labels=(hints:Awaited<ReturnType<typeof rawHints>>)=>hints.map(h=>typeof h.label==="string"?h.label:h.label.map(p=>p.value).join(""));
  const collisions=(value:NonNullable<typeof publication>)=>value.diagnostics.filter(d=>d.code==="OXIDE004").length;
  try{
    editor.setModel(model);
    await step("document-source-production-inlay-provider-and-monaco-rendering",async()=>{
      await configure();
      await synchronize("/* 😀 */\r\nINSERT INTO db.app.ledger VALUES(1);\r\nINSERT INTO other.app.ledger VALUES(2);\r\nINSERT INTO sales.ledger SELECT 3;\r\nINSERT INTO remote.db.app.ledger VALUES(4);");
      const expected=["local_value:","other_value:","sales_value:","remote_value:"];
      check(JSON.stringify(labels(await rawHints()))===JSON.stringify(expected),"real protocol inlay labels retain all four source namespaces");
      core=registerLspCoreProviders({canUseLsp:true,documentUri:uri,editorLanguageId:"sql",serverDialect:"sqlserver",lspClient:client,monaco,documentVersionsRef:{current:new Map([[uri,model.getVersionId()]])},documentTextsRef:{current:new Map([[uri,model.getValue()]])}});
      receipt.productionCoreProviders=true;editor.updateOptions({inlayHints:{enabled:"on",fontSize:14}});
      const deadline=Date.now()+10000;
      while(Date.now()<deadline&&!expected.every(label=>(editor.getDomNode()?.textContent??"").includes(label)))await new Promise(resolve=>setTimeout(resolve,25));
      check(expected.every(label=>(editor.getDomNode()?.textContent??"").includes(label)),"actual Monaco inlay controller renders production provider source labels");
      receipt.renderedInlays=true;
    });
    await step("document-source-rendered-inlay-refresh-without-sql-edits",async()=>{
      const text=model.getValue(),version=model.getVersionId();
      for(const [column,old] of [["updated","other_value"],["other_value","updated"],["updated","other_value"]] as const){
        const start=performance.now();await configure(column);
        check(labels(await rawHints()).includes(`${column}:`),"native metadata refreshed before checking the rendered inlay");
        const refreshDeadline=Date.now()+5000;
        while(Date.now()<refreshDeadline&&(!(editor.getDomNode()?.textContent??"").includes(`${column}:`)||(editor.getDomNode()?.textContent??"").includes(`${old}:`)))await new Promise(resolve=>setTimeout(resolve,25));
        check((editor.getDomNode()?.textContent??"").includes(`${column}:`)&&!(editor.getDomNode()?.textContent??"").includes(`${old}:`),"rendered inlays refresh after metadata changes without a SQL edit");
        check(["local_value:","sales_value:","remote_value:"].every(label=>(editor.getDomNode()?.textContent??"").includes(label)),"unmodified sources retain their actual inlay labels");
        check(model.getValue()===text&&model.getVersionId()===version,"rendered refresh preserves SQL and Monaco model version");
        receipt.inlayRefreshMilliseconds.push(performance.now()-start);
      }
      receipt.renderedInlayRefresh=true;core?.dispose();core=undefined;editor.updateOptions({inlayHints:{enabled:"off"}});
      for(const [targets,repetitions] of [[1,256],[64,4],[65,4]] as const){
        await configure("other_value",targets);await synchronize(Array.from({length:repetitions},()=>Array.from({length:targets},(_,i)=>`INSERT INTO other.app.t${i} VALUES(1);`).join("\n")).join("\n"));
        const rounds=10,warmup=2,milliseconds:number[]=[];let count=0;
        for(let i=0;i<rounds+warmup;i++){const start=performance.now();const hints=await rawHints();if(i>=warmup)milliseconds.push(performance.now()-start);const names=labels(hints);count=names.length;check(count===Math.min(targets,64)*repetitions,"real native inlay workload respects target budget and reuses cached bindings");check(!names.includes("c64:"),"sixty-fifth distinct target cannot bypass the request budget");}
        const sorted=[...milliseconds].sort((a,b)=>a-b);receipt.inlayPerformanceSamples.push({targets,repetitions,rounds,warmup,hints:count,milliseconds,p50Milliseconds:sorted[Math.ceil(rounds*.5)-1]!,p95Milliseconds:sorted[Math.ceil(rounds*.95)-1]!});
      }
    });
    await step("document-source-same-sql-inlays-pushed-and-inline-diagnostics-refresh",async()=>{
      await configure();const sql="INSERT INTO other.app.ledger VALUES(1); SELECT shared FROM db.app.collision a JOIN other.app.collision b ON 1=1;";
      let result=await synchronize(sql);check(collisions(result)===1,"pushed diagnostics detect the actual cross-catalog collision");
      for(const [column,count] of [["updated",0],["other_value",1],["updated",0]] as const){
        await configure(column);result=await waitDiagnostics();check(collisions(result)===count,"same-document pushed diagnostic refresh follows source metadata");
        check(JSON.stringify(labels(await rawHints()))===JSON.stringify([`${column}:`]),"same-document protocol hints do not reuse a stale source label");
        const inline=await client.validateInlineCompletion(uri,sql);check(inline.filter(d=>d.message.includes("multiple referenced relations")).length===count,"inline validation shares cross-catalog diagnostic bindings");
        check(model.getValue()===sql,"metadata refresh does not require changing SQL");
      }
      receipt.protocolRefresh=true;receipt.diagnosticRefresh=true;
    });
    return receipt;
  }finally{
    core?.dispose();editor.updateOptions({inlayHints:{enabled:"off"}});editor.setModel(original);if(opened)await client.didClose(uri);unlisten();model.dispose();await environment.restoreConfiguration();
  }
}
