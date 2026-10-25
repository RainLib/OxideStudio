// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Monaco } from "@monaco-editor/react";
import {createLspRuntimeObservation} from "@/services/lsp/client/runtimeObservation";
import { getLspDocumentUri } from "@/services/lsp";
import {getLspProjectDocumentUri} from "@/services/lsp/document";
import {createProjectDocumentSync} from "@/features/lsp-sync/runtime/createProjectDocumentSync";
import {
  LSP_DOCUMENT_CHANGE_DEBOUNCE_MS,
  useLspDocumentLifecycle,
  type LspDocumentLifecycleClient,
} from "./useLspDocumentLifecycle";

type ControllerOptions = Parameters<typeof useLspDocumentLifecycle>[0];
type Controller = ReturnType<typeof useLspDocumentLifecycle>;

let root: Root;
let container: HTMLDivElement;
let controller: Controller;

function Harness(props: ControllerOptions) {
  controller = useLspDocumentLifecycle(props);
  return null;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function client(overrides: Partial<LspDocumentLifecycleClient> = {}) {
  const snapshot={ready:true,generation:{}};
  return {
    getRuntimeSnapshot:()=>snapshot,subscribeRuntime:()=>()=>{},
    didOpen: vi.fn().mockResolvedValue(undefined),
    didChange: vi.fn().mockResolvedValue(undefined),
    didClose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as LspDocumentLifecycleClient & {
    didOpen: ReturnType<typeof vi.fn>;
    didChange: ReturnType<typeof vi.fn>;
    didClose: ReturnType<typeof vi.fn>;
  };
}

async function renderController(options: ControllerOptions) {
  await act(async () => root.render(<Harness {...options} />));
}

async function eventually(assertion: () => void) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      if (attempt === 19) throw error;
      await act(async () => Promise.resolve());
    }
  }
}

const uriOne = getLspDocumentUri("tab-1", "postgresql", "sql");
const uriTwo = getLspDocumentUri("tab-2", "mysql", "sql");

describe("useLspDocumentLifecycle", () => {
  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("keeps one shared wire document and diagnostics when a sibling editor unmounts", async () => {
    const lspClient=client(),setModelMarkers=vi.fn(),model={getValue:()=>"SELECT 1",isDisposed:()=>false};
    const monaco={Uri:{parse:(value:string)=>value},editor:{getModel:()=>model,setModelMarkers}} as unknown as Monaco;
    const options:ControllerOptions={activeTabId:"shared",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sql",documentUri:uriOne,lspClient,lspReady:true,lspSessionKey:"sibling-editors",monaco,tabs:[{id:"tab-1",type:"query"},{id:"shared",type:"query"}]};
    await act(async()=>root.render(<><Harness key="left" {...options}/><Harness key="right" {...options}/></>));
    await eventually(()=>expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(true));
    expect(lspClient.didOpen).toHaveBeenCalledTimes(1);
    await act(async()=>root.render(<Harness key="right" {...options}/>));
    expect(lspClient.didClose).not.toHaveBeenCalled();
    expect(setModelMarkers).not.toHaveBeenCalled();
    await controller.syncDocument({getValue:()=>"SELECT 2"});
    expect(lspClient.didChange).toHaveBeenCalledWith(uriOne,"SELECT 2",2);
    await act(async()=>root.render(null));
    await eventually(()=>expect(lspClient.didClose).toHaveBeenCalledTimes(1));
    expect(setModelMarkers).toHaveBeenCalledWith(model,"sql-lsp",[]);
  });

  it("keeps unsaved editor content over project snapshots and survives index disposal", async () => {
    const lspClient=Object.assign(client(),{getSessionKey:()=>"project-and-editor"}),index=createProjectDocumentSync();
    const uri=getLspProjectDocumentUri("shared-project","query.sql");
    try {
      await index.synchronize({activeProjectId:"shared-project",lspClient,documents:[{relativePath:"query.sql",content:"SELECT disk_value"}],languageId:"sql"});
      await renderController({activeTabId:"shared",activeDocumentText:"SELECT unsaved_value",canUseLsp:true,documentLanguageId:"sql",documentUri:uri,lspClient,lspReady:true,lspSessionKey:lspClient.getSessionKey(),tabs:[{id:"shared",type:"query"}]});
      await eventually(()=>expect(controller.openedDocumentsRef.current.has(uri)).toBe(true));
      expect(lspClient.didOpen).toHaveBeenCalledTimes(1);
      expect(lspClient.didChange).toHaveBeenLastCalledWith(uri,"SELECT unsaved_value",2);
      await index.synchronize({activeProjectId:"shared-project",lspClient,documents:[{relativePath:"query.sql",content:"SELECT refreshed_disk_value"}],languageId:"sql"});
      expect(lspClient.didChange).toHaveBeenCalledTimes(1);
      expect(controller.documentTextsRef.current.get(uri)).toBe("SELECT unsaved_value");
      await index.closeAll();
      expect(lspClient.didClose).not.toHaveBeenCalled();
      await controller.syncDocument({getValue:()=>"SELECT changed_value"});
      expect(lspClient.didChange).toHaveBeenLastCalledWith(uri,"SELECT changed_value",3);
    } finally { await index.closeAll(); }
  });

  it("opens once and sends ordered changes for the active virtual document", async () => {
    const lspClient = client();
    const options: ControllerOptions = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController(options);
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));
    expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(true);
    expect(controller.documentVersionsRef.current.get(uriOne)).toBe(1);

    vi.useFakeTimers();
    await renderController({ ...options, activeDocumentText: "select 2" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LSP_DOCUMENT_CHANGE_DEBOUNCE_MS);
    });
    await eventually(() => expect(lspClient.didChange).toHaveBeenCalledTimes(1));
    expect(lspClient.didChange).toHaveBeenCalledWith(uriOne, "select 2", 2);
    expect(controller.documentTextsRef.current.get(uriOne)).toBe("select 2");
  });

  it("coalesces rapid editor revisions into the latest LSP change", async () => {
    const lspClient = client();
    const options: ControllerOptions = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController(options);
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));
    vi.useFakeTimers();

    await renderController({ ...options, activeDocumentText: "select 12" });
    await renderController({ ...options, activeDocumentText: "select 123" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LSP_DOCUMENT_CHANGE_DEBOUNCE_MS);
    });

    await eventually(() => expect(lspClient.didChange).toHaveBeenCalledTimes(1));
    expect(lspClient.didChange).toHaveBeenCalledWith(uriOne, "select 123", 2);
  });

  it("closes a late didOpen result after the editor context changes", async () => {
    const firstOpen = deferred();
    const lspClient = client({
      didOpen: vi
        .fn()
        .mockImplementationOnce(() => firstOpen.promise)
        .mockResolvedValue(undefined),
    });
    const tabs = [
      { id: "tab-1", type: "query" },
      { id: "tab-2", type: "query" },
    ];

    await renderController({
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lifecycleKey: "postgresql",
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs,
    });
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));

    await renderController({
      activeTabId: "tab-2",
      activeDocumentText: "select 2",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriTwo,
      lifecycleKey: "mysql",
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      tabs,
    });
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(2));

    await act(async () => firstOpen.resolve(undefined));
    await eventually(() => expect(lspClient.didClose).toHaveBeenCalledWith(uriOne));
    expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(false);
    expect(controller.openedDocumentsRef.current.has(uriTwo)).toBe(true);
  });

  it("closes old session ownership before reopening in a new session", async () => {
    const firstClient = client();
    const secondClient = client();
    const base: Omit<ControllerOptions, "lspClient" | "lspSessionKey"> = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspReady: true,
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController({
      ...base,
      lspClient: firstClient,
      lspSessionKey: "session-1",
    });
    await eventually(() => expect(firstClient.didOpen).toHaveBeenCalledTimes(1));

    await renderController({
      ...base,
      lspClient: secondClient,
      lspSessionKey: "session-2",
    });
    await eventually(() => expect(firstClient.didClose).toHaveBeenCalledWith(uriOne));
    await eventually(() => expect(secondClient.didOpen).toHaveBeenCalledTimes(1));
  });

  it("serializes a remount behind cleanup of an in-flight didOpen", async () => {
    const firstOpen = deferred();
    const lspClient = client({
      didOpen: vi
        .fn()
        .mockImplementationOnce(() => firstOpen.promise)
        .mockResolvedValue(undefined),
    });
    const options: ControllerOptions = {
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-remount",
      tabs: [{ id: "tab-1", type: "query" }],
    };

    await renderController(options);
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));
    await act(async () => root.render(null));
    await renderController(options);
    expect(lspClient.didOpen).toHaveBeenCalledTimes(1);

    await act(async () => firstOpen.resolve(undefined));
    await eventually(() => expect(lspClient.didClose).toHaveBeenCalledWith(uriOne));
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(2));
  });

  it("closes removed tabs and clears their Monaco diagnostics", async () => {
    const lspClient = client();
    const model = {getValue:()=>"select 1",isDisposed:()=>false};
    const setModelMarkers = vi.fn();
    const monaco = {
      Uri: { parse: vi.fn(() => ({ uri: uriOne })) },
      editor: {
        getModel: vi.fn(() => model),
        setModelMarkers,
      },
    } as unknown as Monaco;

    await renderController({
      activeTabId: "tab-1",
      activeDocumentText: "select 1",
      canUseLsp: true,
      documentLanguageId: "sql",
      documentUri: uriOne,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      monaco,
      tabs: [{ id: "tab-1", type: "query" }],
    });
    await eventually(() => expect(lspClient.didOpen).toHaveBeenCalledTimes(1));

    await renderController({
      activeTabId: null,
      activeDocumentText: "",
      canUseLsp: false,
      documentLanguageId: "sql",
      documentUri: null,
      lspClient,
      lspReady: true,
      lspSessionKey: "session-1",
      monaco,
      tabs: [],
    });
    await eventually(() => expect(lspClient.didClose).toHaveBeenCalledWith(uriOne));
    expect(setModelMarkers).toHaveBeenCalledWith(model, "sql-lsp", []);
  });
  it("retains an explicitly owned file URI until its actual tab is removed",async()=>{
    const lspClient=client(),uri="oxide-file-query://project/file.sql";
    const options:ControllerOptions={activeTabId:"file",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sqlite",documentUri:uri,lspClient,lspReady:true,lspSessionKey:"file-query:scope",tabs:[{id:"file",type:"query"}]};
    await renderController(options);await eventually(()=>expect(controller.openedDocumentsRef.current.has(uri)).toBe(true));
    await renderController({...options,tabs:[{id:"file",type:"query"}]});expect(lspClient.didClose).not.toHaveBeenCalled();
    await renderController({...options,activeTabId:null,documentUri:null,canUseLsp:false,tabs:[]});await eventually(()=>expect(lspClient.didClose).toHaveBeenCalledWith(uri));
  });
  it("serializes provider sync with an in-flight lifecycle open",async()=>{
    const open=deferred(),lspClient=client({didOpen:vi.fn().mockImplementationOnce(()=>open.promise).mockResolvedValue(undefined)}),uri="oxide-file-query://project/queued.sql";
    await renderController({activeTabId:"file",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sqlite",documentUri:uri,lspClient,lspReady:true,lspSessionKey:"file-query:queued",tabs:[{id:"file",type:"query"}]});
    await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledOnce());const pending=controller.syncDocument({getValue:()=>"SELECT 2"});expect(lspClient.didOpen).toHaveBeenCalledOnce();
    await act(async()=>open.resolve());await pending;expect(lspClient.didOpen).toHaveBeenCalledOnce();expect(lspClient.didChange).toHaveBeenCalledWith(uri,"SELECT 2",2);
  });
  it("reads the live model instead of reverting to a stale deferred text prop",async()=>{
    let value="SELECT 1";const model={getValue:()=>value,isDisposed:()=>false},lspClient=client(),uri="oxide-file-query://project/live-model.sql";
    const monaco={Uri:{parse:(uri:string)=>uri},editor:{getModel:()=>model,setModelMarkers:vi.fn()}} as unknown as Monaco;
    const options:ControllerOptions={activeTabId:"file",activeDocumentText:value,canUseLsp:true,documentLanguageId:"sqlite",documentUri:uri,lspClient,lspReady:true,lspSessionKey:"file-query:live-model",monaco,tabs:[{id:"file",type:"query"}]};
    await renderController(options);vi.useFakeTimers();value="SELECT 3";await controller.syncDocument(model);await renderController({...options,activeDocumentText:"SELECT 2"});
    await act(async()=>vi.advanceTimersByTimeAsync(LSP_DOCUMENT_CHANGE_DEBOUNCE_MS));expect(controller.documentTextsRef.current.get(uri)).toBe("SELECT 3");expect(lspClient.didChange).toHaveBeenCalledTimes(1);
  });
  it("reopens the same URI after a process incarnation changes even when SQL is unchanged",async()=>{
    const lspClient=client(),uri="oxide-file-query://project/restart.sql",options:ControllerOptions={activeTabId:"file",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sqlite",documentUri:uri,lspClient,lspReady:true,lspSessionKey:"file-query:restart",lifecycleKey:{},tabs:[{id:"file",type:"query"}]};
    await renderController(options);await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledOnce());await renderController({...options,lifecycleKey:{}});
    await act(async()=>new Promise(resolve=>setTimeout(resolve,LSP_DOCUMENT_CHANGE_DEBOUNCE_MS+10)));await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledTimes(2));expect(lspClient.didClose).toHaveBeenCalledWith(uri);
  });

  it("withdraws document ownership when the client disconnects without a ready-prop change",async()=>{
    const process=createLspRuntimeObservation();process.setReady(true);const lspClient=client({getRuntimeSnapshot:process.getSnapshot,subscribeRuntime:process.subscribe});
    await renderController({activeTabId:"tab-1",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sql",documentUri:uriOne,lspClient,lspReady:true,lspSessionKey:"runtime-disconnect",tabs:[{id:"tab-1",type:"query"}]});
    await eventually(()=>expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(true));await act(async()=>{process.setReady(false);});
    expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(false);await expect(controller.syncDocument({getValue:()=>"SELECT 2"})).rejects.toThrow("unavailable");
  });
  it("reopens unchanged text for a new process even when ready never renders false",async()=>{
    const process=createLspRuntimeObservation();process.setReady(true);const lspClient=client({getRuntimeSnapshot:process.getSnapshot,subscribeRuntime:process.subscribe});
    await renderController({activeTabId:"tab-1",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sql",documentUri:uriOne,lspClient,lspReady:true,lspSessionKey:"runtime-fast",tabs:[{id:"tab-1",type:"query"}]});
    await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledOnce());await act(async()=>{process.setReady(true,true);});
    await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledTimes(2));expect(lspClient.didClose).toHaveBeenCalledWith(uriOne);expect(controller.documentTextsRef.current.get(uriOne)).toBe("SELECT 1");
  });
  it("keeps an old open and queued provider sync behind the replacement process generation",async()=>{
    const process=createLspRuntimeObservation();process.setReady(true);const gate=deferred(),trace:string[]=[];
    const lspClient=client({getRuntimeSnapshot:process.getSnapshot,subscribeRuntime:process.subscribe,
      didOpen:vi.fn().mockImplementationOnce(()=>{trace.push("old-open");return gate.promise;}).mockImplementation(async()=>{trace.push("new-open");}),didClose:vi.fn(async()=>{trace.push("close");})});
    await renderController({activeTabId:"tab-1",activeDocumentText:"SELECT 1",canUseLsp:true,documentLanguageId:"sql",documentUri:uriOne,lspClient,lspReady:true,lspSessionKey:"runtime-held",tabs:[{id:"tab-1",type:"query"}]});
    await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledOnce());const pending=controller.syncDocument({getValue:()=>"SELECT 2"}).then(()=>null,error=>error);
    await act(async()=>{process.setReady(false);process.setReady(true);});await act(async()=>{gate.resolve();});
    await eventually(()=>expect(lspClient.didOpen).toHaveBeenCalledTimes(2));expect(await pending).toBeInstanceOf(Error);expect(lspClient.didChange).not.toHaveBeenCalled();
    expect(trace.lastIndexOf("new-open")).toBeGreaterThan(trace.lastIndexOf("close"));expect(controller.openedDocumentsRef.current.has(uriOne)).toBe(true);
  });

});
