import {expect,it,vi} from "vitest";
import {bindLspDocumentSynchronizer,commitLspDocumentShadow,subscribeLspDocumentShadow,syncLspModelBeforeCompletion} from "./lspDocumentSync";
function fixture(){
  const uri="oxide://shadow/query.sql",versions=new Map<string,number>(),texts=new Map<string,string>(),opened=new Set<string>();
  const client={didOpen:vi.fn().mockResolvedValue(undefined),didChange:vi.fn().mockResolvedValue(undefined)};
  return {uri,versions,texts,opened,client,sync:()=>syncLspModelBeforeCompletion({uri,model:{getValue:()=>"SELECT 1"},languageId:"postgres",client,openedDocuments:opened,documentVersions:versions,documentTexts:texts})};
}
it("notifies only after the acknowledged shadow maps are committed",async()=>{
  const f=fixture(),observed:any[]=[];let complete!:()=>void;
  f.client.didOpen.mockReturnValue(new Promise<void>(done=>{complete=done;}));
  const release=subscribeLspDocumentShadow(f.versions,uri=>observed.push([uri,f.versions.get(uri),f.texts.get(uri)]));
  const pending=f.sync();expect(observed).toEqual([]);complete();await pending;expect(observed).toEqual([[f.uri,1,"SELECT 1"]]);release();
});
it("does not notify on failed synchronization or leak between editor registries",async()=>{
  const f=fixture(),other=fixture(),notify=vi.fn(),release=subscribeLspDocumentShadow(f.versions,notify);
  await other.sync();f.client.didOpen.mockRejectedValueOnce(new Error("transport failed"));await expect(f.sync()).rejects.toThrow();expect(notify).not.toHaveBeenCalled();
  await f.sync();expect(notify).toHaveBeenCalledOnce();release();f.opened.clear();await f.sync();expect(notify).toHaveBeenCalledOnce();
});
it("a failed consumer cannot prevent later shadow subscribers or commit",async()=>{
  const f=fixture(),report=vi.spyOn(console,"error").mockImplementation(()=>{}),notify=vi.fn();
  const first=subscribeLspDocumentShadow(f.versions,()=>{throw new Error("consumer failed");}),second=subscribeLspDocumentShadow(f.versions,notify);
  await f.sync();expect(notify).toHaveBeenCalledWith(f.uri);expect(f.versions.get(f.uri)).toBe(1);first();second();report.mockRestore();
});
it("routes an owned provider sync through its lease and rejects late calls after disposal",async()=>{
  const f=fixture(),owned=vi.fn(async()=>{}),release=bindLspDocumentSynchronizer(f.versions,f.uri,owned);
  await f.sync();expect(owned).toHaveBeenCalledOnce();expect(f.client.didOpen).not.toHaveBeenCalled();release();
  await expect(f.sync()).rejects.toThrow("released");expect(f.client.didOpen).not.toHaveBeenCalled();
});
it("does not let an old unbind erase its replacement binding",async()=>{
  const f=fixture(),a=vi.fn(async()=>{}),b=vi.fn(async()=>{}),old=bindLspDocumentSynchronizer(f.versions,f.uri,a),next=bindLspDocumentSynchronizer(f.versions,f.uri,b);
  old();await f.sync();expect(a).not.toHaveBeenCalled();expect(b).toHaveBeenCalledOnce();next();
});
it("commits a shared wire revision once and suppresses duplicate shadow notifications",()=>{
  const f=fixture(),observe=vi.fn(),release=subscribeLspDocumentShadow(f.versions,observe);
  const options={uri:f.uri,text:"SELECT 2",version:9,openedDocuments:f.opened,documentVersions:f.versions,documentTexts:f.texts};
  commitLspDocumentShadow(options);commitLspDocumentShadow(options);expect(observe).toHaveBeenCalledOnce();expect(f.opened.has(f.uri)).toBe(true);expect(f.versions.get(f.uri)).toBe(9);release();
});
