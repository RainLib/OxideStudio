import type {LspDocumentSymbol,LspFoldingRange,LspSelectionRange,Position} from "../types";
import type {LspClientBridge} from "./contracts";
import {isObject} from "./parsing";

export type DocumentStructureItems={symbols:LspDocumentSymbol[];folding:LspFoldingRange[];selection:LspSelectionRange[]};
export type DocumentStructureKind=keyof DocumentStructureItems;
export type DocumentStructureRequest<K extends DocumentStructureKind=DocumentStructureKind>={uri:string;version:number;dialect:string;kind:K;positions?:Position[]};
export type DocumentStructureSnapshot<K extends DocumentStructureKind=DocumentStructureKind>=Omit<DocumentStructureRequest<K>,"positions">&{items:DocumentStructureItems[K]};
const integer=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;
const position=(value:unknown):value is Position=>isObject(value)&&integer(value.line)&&integer(value.character);
const ordered=(a:Position,b:Position)=>a.line<b.line||a.line===b.line&&a.character<=b.character;
const range=(value:any)=>isObject(value)&&position(value.start)&&position(value.end)&&ordered(value.start,value.end);
const contains=(outer:any,inner:any)=>range(outer)&&range(inner)&&ordered(outer.start,inner.start)&&ordered(inner.end,outer.end);
function validItems(kind:DocumentStructureKind,items:unknown[],positions:Position[]){
  if(kind==="folding")return items.every(item=>isObject(item)&&integer(item.startLine)&&integer(item.endLine)&&item.startLine<=item.endLine&&(item.startCharacter===undefined||integer(item.startCharacter))&&(item.endCharacter===undefined||integer(item.endCharacter)));
  if(kind==="selection"&&items.length!==positions.length)return false;
  const stack=items.slice(),seen=new Set<unknown>();
  while(stack.length){const item=stack.pop();if(!isObject(item)||seen.has(item))return false;seen.add(item);
    if(!range(item.range))return false;
    if(kind==="symbols"){
      if(typeof item.name!=="string"||!integer(item.kind)||item.kind<1||item.kind>26||!contains(item.range,item.selectionRange))return false;
      if(item.children!==undefined){if(!Array.isArray(item.children))return false;stack.push(...item.children);}
    }else if(item.parent!==undefined){if(!isObject(item.parent)||!contains(item.parent.range,item.range))return false;stack.push(item.parent);}
  }
  return true;
}
export async function getLspDocumentStructure<K extends DocumentStructureKind>(client:LspClientBridge,request:DocumentStructureRequest<K>):Promise<DocumentStructureSnapshot<K>|null>{
  const positions=request.positions??[];
  if(!client.isInitialized()||typeof request.uri!=="string"||!Number.isSafeInteger(request.version)||request.version<0||request.version>2147483647||
    !/^[a-z0-9_-]{1,64}$/.test(request.dialect)||!["symbols","folding","selection"].includes(request.kind)||!Array.isArray(positions)||!positions.every(position)||request.kind!=="selection"&&positions.length)return null;
  const result=await client.request<unknown>("oxide/documentStructure",{textDocument:{uri:request.uri},version:request.version,dialect:request.dialect,kind:request.kind,...(request.kind==="selection"?{positions}:{})});
  if(!client.isInitialized()||!isObject(result)||result.uri!==request.uri||result.version!==request.version||result.dialect!==request.dialect||result.kind!==request.kind||result.oxideAnalysisToken!==undefined||!Array.isArray(result.items)||!validItems(request.kind,result.items,positions))return null;
  return result as unknown as DocumentStructureSnapshot<K>;
}
