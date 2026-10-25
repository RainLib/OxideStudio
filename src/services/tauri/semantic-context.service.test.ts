import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@/services/tauri/client",()=>({invokeWithInterceptors:mocks.invoke}));
vi.mock("@tauri-apps/api/event",()=>({listen:mocks.listen}));
import {getConnectionSemanticState,listenConnectionSemanticState,parseConnectionSemanticState} from "./semantic-context.service";
const valid=()=>({connectionId:"id",session:"11111111-2222-4333-8444-555555555555",revision:1,activeOperations:0,openTransactions:0,connected:true,uncertain:false});
beforeEach(()=>{vi.resetAllMocks();});
it("reads the exact connection through the shared client",async()=>{
  mocks.invoke.mockResolvedValue(valid());await expect(getConnectionSemanticState("id")).resolves.toEqual(valid());
  expect(mocks.invoke).toHaveBeenCalledWith("get_connection_semantic_state",{connectionId:"id"});
});
it("keeps an absent live connection unknown",async()=>{mocks.invoke.mockResolvedValue(null);await expect(getConnectionSemanticState("id")).resolves.toBeNull();});
it("rejects a state from another connection",async()=>{mocks.invoke.mockResolvedValue({...valid(),connectionId:"other"});await expect(getConnectionSemanticState("id")).rejects.toThrow("scope mismatch");});
it.each([-1,1.5,Number.MAX_SAFE_INTEGER+1])("rejects unsafe revision %s",revision=>{expect(()=>parseConnectionSemanticState({...valid(),revision})).toThrow("Invalid");});
it.each([{session:"invented"},{activeOperations:-1},{openTransactions:1025},{uncertain:"false"}])("rejects malformed event fields %o",patch=>{expect(()=>parseConnectionSemanticState({...valid(),...patch})).toThrow("Invalid");});
it("copies only the seven sanitized fields",()=>{expect(parseConnectionSemanticState({...valid(),sql:"private statement",password:"secret"})).toEqual(valid());});
it("validates streamed events and returns their real unsubscribe handle",async()=>{
  const unsubscribe=vi.fn();mocks.listen.mockResolvedValue(unsubscribe);const listener=vi.fn();
  expect(await listenConnectionSemanticState(listener)).toBe(unsubscribe);
  const callback=mocks.listen.mock.calls[0]![1];callback({payload:{...valid(),sql:"private"}});callback({payload:{bad:true}});
  expect(listener).toHaveBeenCalledExactlyOnceWith(valid());
});
