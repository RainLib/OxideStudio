import {beforeEach,expect,it,vi} from "vitest";
const bridge=vi.hoisted(()=>({invoke:vi.fn()}));vi.mock("@tauri-apps/api/core",()=>({invoke:bridge.invoke}));
import {invokeCommand} from "./invoke";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
const owner={};
beforeEach(()=>{
  vi.resetAllMocks();useConnectionSemanticStore.setState({enabled:false,owner:null,byConnectionId:{},transport:"loading"});
  const api=useConnectionSemanticStore.getState();api.claim(owner);api.listening(owner);
  api.accept(owner,{connectionId:"id",session:"session",revision:1,activeOperations:0,openTransactions:0,connected:true,uncertain:false});
});
const pending=()=>useConnectionSemanticStore.getState().byConnectionId.id?.localOperations;
it.each(["execute_query","execute_read_only_query","import_sql_script","begin_transaction"])("revokes before dispatching %s and releases after its result",async command=>{
  bridge.invoke.mockImplementation(async()=>{expect(pending()).toBe(1);return {success:true,data:[]};});
  await invokeCommand(command,{connectionId:"id",sql:"opaque SQL"});expect(pending()).toBe(0);
});
it("covers nested explain requests without inspecting SQL text",async()=>{
  bridge.invoke.mockImplementation(async()=>{expect(pending()).toBe(1);return {success:true,data:{}};});
  await invokeCommand("explain_query",{request:{connectionId:"id",sql:"SELECT opaque()"}});expect(pending()).toBe(0);
});
it.each(["transport","envelope"])("releases on %s failure",async kind=>{
  if(kind==="transport")bridge.invoke.mockRejectedValue(new Error("offline"));
  else bridge.invoke.mockResolvedValue({success:false,error:{code:"QUERY_FAILED",message:"failed"}});
  await expect(invokeCommand("execute_query",{connectionId:"id"})).rejects.toThrow();expect(pending()).toBe(0);
});
it("does not turn metadata reads into a refresh loop",async()=>{
  const before=useConnectionSemanticStore.getState().byConnectionId.id;
  bridge.invoke.mockResolvedValue({success:true,data:[]});await invokeCommand("get_columns",{connectionId:"id"});
  expect(useConnectionSemanticStore.getState().byConnectionId.id).toBe(before);
});
