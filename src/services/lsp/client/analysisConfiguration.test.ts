import { expect, it, vi } from "vitest";
import type { LspClientBridge } from "./contracts";
import { confirmLspAnalysisConfiguration } from "./analysisConfiguration";

function fixture(value: unknown = {applied:true,oxideAnalysisToken:"current"}) {
  const invoke = vi.fn().mockResolvedValue(value);
  const client = {isInitialized:()=>true,requestSessionPayload:()=>({sessionKey:"file-session"}),invoke} as unknown as LspClientBridge;
  return {client,invoke};
}
it("confirms the exact token through the scoped generic transport without SQL", async()=>{
  const f=fixture();expect(await confirmLspAnalysisConfiguration(f.client,"current")).toBe(true);
  expect(f.invoke).toHaveBeenCalledWith("lsp_request",{request:{sessionKey:"file-session",method:"oxide/analysisConfiguration",params:{oxideAnalysisToken:"current"}}});
});
it.each([null,true,[],{applied:true},{applied:"true",oxideAnalysisToken:"current"},{applied:false,oxideAnalysisToken:"current"},{applied:true,oxideAnalysisToken:"other"}])("rejects a malformed or foreign receipt: %o", async value=>{
  expect(await confirmLspAnalysisConfiguration(fixture(value).client,"current")).toBe(false);
});
it.each(["","a b","列","x".repeat(129)])("rejects invalid tokens before IPC: %s",async token=>{
  const f=fixture();expect(await confirmLspAnalysisConfiguration(f.client,token)).toBe(false);expect(f.invoke).not.toHaveBeenCalled();
});
it("does not issue a receipt request for a stopped client",async()=>{
  const f=fixture();f.client.isInitialized=()=>false;expect(await confirmLspAnalysisConfiguration(f.client,"current")).toBe(false);expect(f.invoke).not.toHaveBeenCalled();
});
it("fails closed if the client disconnects during the request",async()=>{
  const f=fixture();f.invoke.mockImplementation(async()=>{f.client.isInitialized=()=>false;return {applied:true,oxideAnalysisToken:"current"};});
  expect(await confirmLspAnalysisConfiguration(f.client,"current")).toBe(false);
});
it("propagates unsupported or failed transport for the configuration owner to report",async()=>{
  const f=fixture();f.invoke.mockRejectedValue(new Error("unsupported"));await expect(confirmLspAnalysisConfiguration(f.client,"current")).rejects.toThrow("unsupported");
});
