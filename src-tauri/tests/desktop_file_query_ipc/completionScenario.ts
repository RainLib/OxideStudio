import type * as Monaco from "monaco-editor";
import type {LspClient} from "@/services/lsp/client/LspClient";

/** Observe the production provider and actual Monaco widget, without replacing
 * either RPC response or provider registration. Only acknowledgement is held. */
export async function prepareLocalCompletionAcceptance(options:{
  client:LspClient;editor:Monaco.editor.ICodeEditor;
  check:(value:unknown,message:string)=>asserts value;
  wait:(test:()=>boolean,message:string)=>Promise<void>;
}) {
  const {client,editor,wait}=options,check:typeof options.check=options.check,model=editor.getModel()!;
  const originalFull=client.getCompletionList,originalLocal=client.getDocumentCompletions;
  let physical=0,local=0;
  const frames:Array<{dialect:string;version:number;labels:string[]}>=[];
  client.getCompletionList=(...args)=>{physical++;return originalFull.apply(client,args);};
  client.getDocumentCompletions=async(...args)=>{
    local++;const result=await originalLocal.apply(client,args);
    frames.push({dialect:args[0].dialect,version:args[0].version,labels:result?.items.map(item=>item.label)??[]});
    return result;
  };
  const visible=()=>Array.from(document.querySelectorAll<HTMLElement>(".suggest-widget.visible")).find(node=>node.getClientRects().length>0);
  const dispose=()=>{client.getCompletionList=originalFull;client.getDocumentCompletions=originalLocal;};
  try {
    const offset=model.getValue().indexOf("q.locSuffix")+"q.loc".length;
    check(offset>"q.loc".length,"complex file fixture has a member suffix for real acceptance");
    editor.setPosition(model.getPositionAt(offset));editor.focus();editor.trigger("file.local-completion","editor.action.triggerSuggest",{});
    await wait(()=>Boolean(visible()?.textContent?.includes("local_count")),"confirmed file shows its actual local candidate widget");
    check(physical>0&&local===0,"confirmed widget uses the physical-enabled production path");
    const beforePhysical=physical;
    return {
      dispose,
      async pending() {
        await wait(()=>local>0&&frames.length>0&&Boolean(visible()?.textContent?.includes("local_count")),"the same visible interaction automatically recovers with document-only CTE candidates while acknowledgement is held");
        check(physical===beforePhysical,"unconfirmed widget recovery never starts a physical completion RPC");
        check(frames.some(frame=>frame.dialect==="duckdb"&&frame.labels.includes("local_count")),"actual scoped response preserves signed DuckDB identity and inferred local columns");
        check(frames.every(frame=>!frame.labels.includes("label")&&!frame.labels.includes("id")),"warm physical file columns are excluded from document-only candidates");
        editor.trigger("file.local-completion","acceptSelectedSuggestion",{});
        await wait(()=>!model.getValue().includes("Suffix")&&model.getValue().includes("q.local_count, q.local_count"),"actual pending-state candidate acceptance replaces the entire suffix");
      },
      async confirmed() {
        model.setValue("SELECT d.laSuffix FROM data d");editor.setPosition(model.getPositionAt(model.getValue().indexOf("laSuffix")+2));editor.focus();
        editor.trigger("file.local-completion","editor.action.triggerSuggest",{});
        await wait(()=>physical>beforePhysical&&Boolean(visible()?.textContent?.includes("label")),"acknowledged file restores actual physical column suggestions");
        editor.trigger("file.local-completion","acceptSelectedSuggestion",{});
        await wait(()=>model.getValue()==="SELECT d.label FROM data d","restored physical candidate acceptance preserves exact source column identity");
        return {localCompletionDuringConfirmation:true,automaticLocalWidgetRecovery:true,localSuffixAcceptance:true,physicalCompletionRestored:true,localFrames:frames};
      },
    };
  }catch(error){dispose();throw error;}
}
