import {expect,it,vi} from "vitest";
import type {LspClientBridge} from "./contracts";
import {getLspDiagnosticSnapshot,type DiagnosticSnapshotRequest} from "./diagnostics";
const request:DiagnosticSnapshotRequest={uri:"oxide://query/current.sql",version:7,dialect:"postgres",mode:"metadata",oxideAnalysisToken:"current"};
const diagnostic={message:"parser",code:"SYNTAX_ERROR",range:{start:{line:0,character:1},end:{line:0,character:2}}};
function fixture(value:any={...request,diagnostics:[diagnostic]}){
  const invoke=vi.fn().mockResolvedValue(value);
  const client={isInitialized:()=>true,requestSessionPayload:()=>({sessionKey:"scoped"}),invoke} as unknown as LspClientBridge;
  return {client,invoke};
}
it("dispatches a scoped request and accepts only its coherent response",async()=>{
  const f=fixture();expect(await getLspDiagnosticSnapshot(f.client,request)).toMatchObject({...request,diagnostics:[diagnostic]});
  expect(f.invoke).toHaveBeenCalledWith("lsp_request",{request:{sessionKey:"scoped",method:"oxide/documentDiagnostics",params:{textDocument:{uri:request.uri},version:7,dialect:"postgres",mode:"metadata",oxideAnalysisToken:"current"}}});
});
it("syntax requests omit physical configuration tokens and cannot accept one back",async()=>{
  const f=fixture({...request,mode:"syntax",oxideAnalysisToken:undefined,diagnostics:[diagnostic]});
  const syntax={...request,mode:"syntax" as const};expect(await getLspDiagnosticSnapshot(f.client,syntax)).toMatchObject({mode:"syntax"});
  expect(f.invoke.mock.calls[0]![1].request.params).not.toHaveProperty("oxideAnalysisToken");
  f.invoke.mockResolvedValue({...request,mode:"syntax",diagnostics:[]});expect(await getLspDiagnosticSnapshot(f.client,syntax)).toBeNull();
});
it.each([{uri:"oxide://other.sql"},{version:8},{dialect:"mysql"},{mode:"syntax"},{oxideAnalysisToken:"old"}])("rejects a mismatched response: %o",async patch=>{
  const f=fixture({...request,...patch,diagnostics:[]});expect(await getLspDiagnosticSnapshot(f.client,request)).toBeNull();
});
it.each([-1,1.5,2147483648])("rejects invalid expected versions before IPC: %s",async version=>{
  const f=fixture();expect(await getLspDiagnosticSnapshot(f.client,{...request,version})).toBeNull();expect(f.invoke).not.toHaveBeenCalled();
});
it("does not request metadata with a missing token or a stopped client",async()=>{
  const f=fixture();expect(await getLspDiagnosticSnapshot(f.client,{...request,oxideAnalysisToken:undefined})).toBeNull();
  f.client.isInitialized=()=>false;expect(await getLspDiagnosticSnapshot(f.client,request)).toBeNull();expect(f.invoke).not.toHaveBeenCalled();
});
it.each([{diagnostics:null},{diagnostics:[{message:"bad",range:{start:{line:-1,character:0},end:{line:0,character:1}}}]},{diagnostics:[{message:"bad",range:{start:{line:"0",character:0},end:{line:0,character:1}}}]}])("rejects malformed diagnostics: %o",async patch=>{
  const f=fixture({...request,...patch});expect(await getLspDiagnosticSnapshot(f.client,request)).toBeNull();
});
