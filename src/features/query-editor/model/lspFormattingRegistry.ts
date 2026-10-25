import type {CancellationToken, IDisposable, editor, languages} from "monaco-editor";

type FormattingLanguages=Pick<typeof languages,"registerDocumentFormattingEditProvider"|"registerDocumentRangeFormattingEditProvider">;
type FormatRequest=(model:editor.ITextModel,options:languages.FormattingOptions,token:CancellationToken)=>languages.ProviderResult<languages.TextEdit[]>;
type RangeFormatRequest=(model:editor.ITextModel,range:import("monaco-editor").Range,options:languages.FormattingOptions,token:CancellationToken)=>languages.ProviderResult<languages.TextEdit[]>;
type Owner={request:(model:editor.ITextModel,...args:any[])=>languages.ProviderResult<languages.TextEdit[]>};
type Route={owners:Owner[];revision:number};
type Group={routes:Map<string,Route>;registration:IDisposable};
const registries=new WeakMap<FormattingLanguages,Map<string,Group>>();

/** Monaco selects one formatter before invoking it. Share the language
 * registration and route by the complete URI, including its authority. */
function registerFormattingOwner(api:FormattingLanguages,language:string,uri:string,kind:"document"|"range",owner:Owner):IDisposable {
  let groups=registries.get(api);
  if(!groups){groups=new Map();registries.set(api,groups);}
  const key=kind+":"+language;
  let group=groups.get(key);
  if(!group){
    const routes=new Map<string,Route>();
    const provide=async(model:editor.ITextModel,...args:any[])=>{
      const address=model.uri.toString(),route=routes.get(address),current=route?.owners[route.owners.length-1],revision=route?.revision;
      if(!current||model.isDisposed?.())return [];
      const result=await current.request(model,...args);
      // A newer owner or disposal can invalidate a request without editing SQL.
      return routes.get(address)===route&&route?.revision===revision&&!model.isDisposed?.()?result:[];
    };
    const registration=kind==="document"
      ?api.registerDocumentFormattingEditProvider(language,{provideDocumentFormattingEdits:provide})
      :api.registerDocumentRangeFormattingEditProvider(language,{provideDocumentRangeFormattingEdits:provide});
    group={routes,registration};groups.set(key,group);
  }
  const route=group.routes.get(uri)??{owners:[],revision:0};route.owners.push(owner);route.revision++;group.routes.set(uri,route);
  const ownedGroup=group,ownedGroups=groups;
  let disposed=false;
  return {dispose:()=>{
    if(disposed)return;disposed=true;
    const route=ownedGroup.routes.get(uri),owners=route?.owners;
    const index=owners?.indexOf(owner)??-1;
    if(index>=0){if(index===owners!.length-1)route!.revision++;owners!.splice(index,1);}
    if(!owners?.length)ownedGroup.routes.delete(uri);
    if(ownedGroup.routes.size)return;
    ownedGroup.registration.dispose();ownedGroups.delete(key);
    if(!ownedGroups.size)registries.delete(api);
  }};
}

export function registerLspDocumentFormatter(api:FormattingLanguages,language:string,uri:string,provider:{provideDocumentFormattingEdits:FormatRequest}):IDisposable {
  return registerFormattingOwner(api,language,uri,"document",{request:provider.provideDocumentFormattingEdits});
}
export function registerLspRangeFormatter(api:FormattingLanguages,language:string,uri:string,provider:{provideDocumentRangeFormattingEdits:RangeFormatRequest}):IDisposable {
  return registerFormattingOwner(api,language,uri,"range",{request:provider.provideDocumentRangeFormattingEdits});
}
