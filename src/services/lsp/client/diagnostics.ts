import type {Diagnostic} from "../types";
import type {LspClientBridge} from "./contracts";
import {isObject,parseRange} from "./parsing";

export type DiagnosticSnapshotRequest={uri:string;version:number;dialect:string;mode:"syntax"|"metadata";oxideAnalysisToken?:string};
export type DiagnosticSnapshot=DiagnosticSnapshotRequest & {diagnostics:Diagnostic[]};
const validToken=(value:unknown):value is string=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPosition=(value:unknown)=>isObject(value)&&Number.isSafeInteger(value.line)&&Number(value.line)>=0&&Number.isSafeInteger(value.character)&&Number(value.character)>=0;

export async function getLspDiagnosticSnapshot(client:LspClientBridge,request:DiagnosticSnapshotRequest):Promise<DiagnosticSnapshot|null>{
  if(!client.isInitialized()||!Number.isSafeInteger(request.version)||request.version<0||request.version>2147483647||
    !/^[a-z0-9_-]{1,64}$/.test(request.dialect)||!["syntax","metadata"].includes(request.mode)||
    request.mode==="metadata"&&!validToken(request.oxideAnalysisToken))return null;
  const value=await client.invoke<unknown>("lsp_request",{request:{...client.requestSessionPayload(),method:"oxide/documentDiagnostics",params:{
    textDocument:{uri:request.uri},version:request.version,dialect:request.dialect,mode:request.mode,
    ...(request.mode==="metadata"?{oxideAnalysisToken:request.oxideAnalysisToken}:{}),
  }}});
  if(!isObject(value)||value.uri!==request.uri||value.version!==request.version||value.dialect!==request.dialect||value.mode!==request.mode||!Array.isArray(value.diagnostics))return null;
  if(request.mode==="metadata"?value.oxideAnalysisToken!==request.oxideAnalysisToken:value.oxideAnalysisToken!==undefined)return null;
  const diagnostics:Diagnostic[]=[];
  for(const item of value.diagnostics){
    if(!isObject(item)||typeof item.message!=="string")return null;
    if(!isObject(item.range)||!validPosition(item.range.start)||!validPosition(item.range.end))return null;
    const range=parseRange(item.range);if(!range)return null;
    diagnostics.push({...item,range,message:item.message} as Diagnostic);
  }
  return {...request,oxideAnalysisToken:request.mode==="metadata"?request.oxideAnalysisToken:undefined,diagnostics};
}
