import { create } from "zustand";
import { v4 as uuid } from "uuid";
import { databaseService } from "@/services/tauri";
import type { DatabaseDriverInstallation } from "@/services/tauri/types";
import { fileQueryService, type CsvHeader } from "@/services/tauri/file-query.service";
import { useTabStore } from "@/store/useTabStore";
import { useProjectStore } from "@/store/useProjectStore";
import { fileQueryFormat, type FileQuerySource } from "./model";
let catalogueRequest = 0;

interface State {
  source: FileQuerySource | null;
  reuseTabId?: string;
  providers: DatabaseDriverInstallation[];
  provider: string;
  csvHeader: CsvHeader;
  loading: boolean;
  requestId: string | null;
  error: string | null;
  show: (source: FileQuerySource, reuseTabId?: string) => Promise<void>;
  refresh: () => Promise<void>;
  cancel: () => void;
  open: () => Promise<void>;
}

export const useFileQueryStore = create<State>((set, get) => ({
  source: null, providers: [], provider: "", csvHeader: "auto", loading: false, requestId: null, error: null,
  show: async (source, reuseTabId) => {
    get().cancel();
    const old = useTabStore.getState().tabs.find(t => t.id === reuseTabId)?.fileQuery;
    set({ source, reuseTabId, csvHeader: old?.csvHeader ?? "auto", error: null });
    await get().refresh();
  },
  refresh: async () => {
    const source = get().source;
    if (!source) return;
    const request = ++catalogueRequest;
    set({ loading: true, error: null });
    try {
      const format = source.kind === "project" ? fileQueryFormat(source.relativePath) : null;
      const providers = (await databaseService.listDatabaseDriverInstallations()).filter(p =>
        p.distribution === "external" && p.active && p.status === "ready" && p.runtimeReady !== false && p.packageVersion &&
        (p.capabilities?.fileQueryFormats?.length ?? 0) > 0 && (!format || p.capabilities?.fileQueryFormats?.includes(format)));
      if (get().source !== source || request !== catalogueRequest) return;
      const previous = useTabStore.getState().tabs.find(t => t.id === get().reuseTabId)?.fileQuery;
      const preferred = providers.find(p => p.driver === previous?.driverId && p.packageVersion === previous.packageVersion) ?? providers[0];
      set({ providers, provider: preferred ? `${preferred.driver}@${preferred.packageVersion}` : "", loading: false });
    } catch (error) {
      if (get().source === source && request === catalogueRequest) set({ loading: false, providers: [], error: error instanceof Error ? error.message : String(error) });
    }
  },
  cancel: () => {
    catalogueRequest++;
    const { source, requestId } = get();
    if (source && requestId) void fileQueryService.cancelOpen(source.projectId, requestId).catch(() => undefined);
    set({ source: null, requestId: null, loading: false });
  },
  open: async () => {
    const { source, providers, provider, csvHeader, reuseTabId } = get();
    if (!source || get().requestId) return;
    const selected = providers.find(p => `${p.driver}@${p.packageVersion}` === provider);
    if (!selected) return;
    const requestId = uuid();
    set({ requestId, error: null });
    try {
      const previous = useTabStore.getState().tabs.find(t => t.id === reuseTabId)?.fileQuery?.session;
      if (previous) {
        await fileQueryService.close(previous);
        useTabStore.setState(state => ({ tabs: state.tabs.map(t => t.id === reuseTabId && t.fileQuery?.session?.id === previous.id ? { ...t,lspDiagnostics:[], fileQuery: { ...t.fileQuery, session: null } } : t) }));
      }
      if (get().requestId !== requestId) return;
      const selection = { driverId: selected.driver, packageVersion: selected.packageVersion!, csvHeader, requestId };
      const session = source.kind === "project"
        ? await fileQueryService.openProject({ ...source, ...selection })
        : await fileQueryService.pick({ projectId: source.projectId, ...selection });
      if (!session) { if (get().requestId === requestId) set({ requestId: null }); return; }
      if (get().requestId !== requestId || useProjectStore.getState().activeProjectId !== source.projectId) {
        await fileQueryService.close(session); return;
      }
      // Describe the private view with a zero-row query before the editor can
      // run user SQL; metadata and execution cannot race for the session lock.
      let schema;
      try { schema = (await fileQueryService.query(session, "SELECT * FROM data LIMIT 0"))[0]?.columns; }
      catch (error) { await fileQueryService.close(session); throw error; }
      if (get().requestId !== requestId || useProjectStore.getState().activeProjectId !== source.projectId) { await fileQueryService.close(session); return; }
      const document = { source, session, schema, driverId: selected.driver, packageVersion: selected.packageVersion!, csvHeader };
      const tab = useTabStore.getState().tabs.find(t => t.id === reuseTabId);
      const id = tab ? tab.id : useTabStore.getState().createTab("query", `${session.fileName} · SQL`, session.initialSql, { fileQuery: document });
      if (tab) useTabStore.setState(state => ({ activeTabId: id, tabs: state.tabs.map(t => t.id === id ? { ...t, title: `${session.fileName} · SQL`, fileQuery: document, results: null, resultRuns: [], error: null } : t) }));
      set({ source: null, requestId: null });
      await useTabStore.getState().runTabQuery(id, "");
    } catch (error) {
      if (get().requestId === requestId) set({ requestId: null, error: error instanceof Error ? error.message : String(error) });
    }
  },
}));

useProjectStore.subscribe((state, previous) => {
  if (state.activeProjectId === previous.activeProjectId) return;
  useFileQueryStore.getState().cancel();
  useTabStore.setState(current=>({tabs:current.tabs.map(tab=>tab.fileQuery?.session?.projectId===previous.activeProjectId
    ?{...tab,isExecuting:false,runningQueryId:null,lspDiagnostics:[],fileQuery:{...tab.fileQuery,session:null}}:tab)}));
  void fileQueryService.closeProject(previous.activeProjectId).catch(() => undefined);
});
