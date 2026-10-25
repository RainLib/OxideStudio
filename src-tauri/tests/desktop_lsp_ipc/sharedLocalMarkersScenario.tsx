import type * as Monaco from "monaco-editor";
import {createRoot} from "react-dom/client";
import {useEffect} from "react";
import {useEditorDiagnostics} from "@/features/query-editor/hooks/useEditorDiagnostics";
import {analyzeMysqlRoutineSyntax} from "@/features/query-editor/model/mysqlRoutineSyntaxDiagnostics";

type Environment={monaco:typeof import("monaco-editor/esm/vs/editor/editor.api.js");editor:Monaco.editor.IStandaloneCodeEditor;
  check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runSharedLocalMarkersAcceptance(environment:Environment){
  const {monaco,editor,step}=environment,check:Environment["check"]=environment.check;
  const previous=editor.getModel(),language="oxide-local-marker-profiles";monaco.languages.register({id:language});
  const model=monaco.editor.createModel("",language,monaco.Uri.parse("oxide-local://shared/query.sql"));editor.setModel(model);
  const pane=document.createElement("div"),host=document.createElement("div");pane.style.cssText="width:480px;height:180px";document.body.append(pane,host);
  const other=monaco.editor.create(pane,{model,quickSuggestions:false,suggestOnTriggerCharacters:false}),root=createRoot(host);
  const trace:unknown[]=[],mounted=new Set<string>();
  const record=(event:string)=>{trace.push({event,aFocus:other.hasTextFocus(),bFocus:editor.hasTextFocus(),version:model.getVersionId(),mysql:monaco.editor.getModelMarkers({owner:"mysql-routine-syntax",resource:model.uri}).map(value=>value.code)});if(trace.length>40)trace.shift();};
  const debugListeners=[other.onDidFocusEditorText(()=>{record("a-focus");queueMicrotask(()=>record("a-focus-settled"));}),other.onDidBlurEditorText(()=>record("a-blur")),editor.onDidFocusEditorText(()=>record("b-focus")),editor.onDidBlurEditorText(()=>record("b-blur"))];
  let driver:"mysql"|"oracle"="mysql";const versions={current:new Map<string,number>()},texts={current:new Map<string,string>()},noProblems=()=>{};
  const routine=(current:Monaco.editor.ITextModel)=>{const result=analyzeMysqlRoutineSyntax(current.getValue());record("routine-"+result.diagnostics.length);return result;};
  function Pane({id}:{id:"a"|"b"}){useEditorDiagnostics({monaco:monaco as unknown as typeof import("monaco-editor"),documentUri:model.uri.toString(),diagnosticTabId:id,lspReady:false,lspSessionKey:"local-marker-fixture",
    documentVersionsRef:versions,documentTextsRef:texts,mysqlRoutineAnalysisForModel:routine,setLspDiagnostics:noProblems,mountedEditor:id==="a"?other:editor,
    activeTab:{id,sql:model.getValue()} as any,driver:id==="a"?driver:"postgres"});useEffect(()=>{mounted.add(id);record("mounted-"+id);return()=>{mounted.delete(id);record("disposed-"+id);};},[id]);return null;}
  const wait=async(test:()=>boolean,message:string)=>{const end=Date.now()+10000;while(!test()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));check(test(),message);};
  const markers=(owner:string)=>monaco.editor.getModelMarkers({owner,resource:model.uri});
  try{
    await step("shared-local-mysql-profile-focus-and-background-timer",async()=>{
      const sql="CREATE PROCEDURE p(IN a INT,) BEGIN SELECT a; END;";model.setValue(sql);const version=model.getVersionId();root.render(<><Pane key="a" id="a"/><Pane key="b" id="b"/></>);
      editor.focus();await wait(()=>editor.hasTextFocus(),"real PostgreSQL pane owns focus before the background MySQL timer");await new Promise(resolve=>setTimeout(resolve,240));
      check(markers("mysql-routine-syntax").length===0,"background real MySQL analysis does not enter the focused PostgreSQL marker layer");
      other.focus();await wait(()=>other.hasTextFocus(),"real MySQL pane has text focus before marker assertion");await wait(()=>markers("mysql-routine-syntax").some(value=>String(value.code).startsWith("MYSQL")),"actual MySQL pane shows its own real routine analysis after focus");
      editor.focus();await wait(()=>markers("mysql-routine-syntax").length===0,"focus back to PostgreSQL withdraws the foreign MySQL layer");
      root.render(<Pane key="b" id="b"/>);await new Promise(resolve=>setTimeout(resolve,100));check(markers("mysql-routine-syntax").length===0,"retired MySQL publisher cannot restore its old errors");
      check(model.getValue()===sql&&model.getVersionId()===version,"profile focus and disposal do not edit SQL");
    });
    await step("shared-local-oracle-profile-remount-and-final-cleanup",async()=>{
      driver="oracle";model.setValue("CREATE TABLE t (id NUMBER NOT NULL DEFAULT 0);");root.render(<Pane key="b" id="b"/>);editor.focus();await wait(()=>editor.hasTextFocus(),"real PostgreSQL pane owns focus before Oracle remount");
      root.render(<><Pane key="b" id="b"/><Pane key="a" id="a"/></>);await new Promise(resolve=>setTimeout(resolve,100));
      check(markers("oracle-syntax").length===0,"background Oracle remount does not enter PostgreSQL's marker layer");
      other.focus();await wait(()=>markers("oracle-syntax").some(value=>value.code==="ORACLE001"),"real Oracle pane shows its own dialect diagnostic after focus");
      root.render(<Pane key="b" id="b"/>);await new Promise(resolve=>setTimeout(resolve,100));check(markers("oracle-syntax").length===0,"retiring focused Oracle publisher preserves the PostgreSQL view");
      root.render(null);await new Promise(resolve=>setTimeout(resolve,50));check(["mysql-routine-syntax","oracle-syntax","database-query"].every(owner=>markers(owner).length===0),"final local publishers release their marker layers");
    });
    return {productionDiagnosticHook:true,realMonacoFocus:true,mysqlRoutineAnalysis:true,oracleAnalysis:true,foreignProfileWithdrawal:true,backgroundTimer:true,remountIsolation:true,lspServerExecuted:false};
  }catch(error){throw new Error((error instanceof Error?error.message:String(error))+"; marker focus trace="+JSON.stringify({mounted:[...mounted],aFocus:other.hasTextFocus(),bFocus:editor.hasTextFocus(),analysis:analyzeMysqlRoutineSyntax(model.getValue()).diagnostics,trace}));}
  finally{root.unmount();for(const listener of debugListeners)listener.dispose();other.dispose();editor.setModel(previous);model.dispose();pane.remove();host.remove();}
}
