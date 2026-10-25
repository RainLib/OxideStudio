/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GridFilterRow } from "@/components/workspace/GridFilterRow";
import {useConnectionStore} from "@/store/useConnectionStore";
import {useSchemaStore} from "@/store/useSchemaStore";
import {useTabStore} from "@/store/useTabStore";
import {useProjectStore} from "@/store/useProjectStore";
import {useLspSemanticStatusStore} from "@/store/useLspSemanticStatusStore";
import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import {semanticConnectionToken,semanticTabRoute} from "@/services/lsp/semanticContext";
const lsp=vi.hoisted(()=>{const runtime={generation:{},ready:true};return {runtime,client:{getRuntimeSnapshot:()=>runtime,subscribeRuntime:()=>()=>{},didOpen:vi.fn().mockResolvedValue(undefined),didChange:vi.fn().mockResolvedValue(undefined),didClose:vi.fn().mockResolvedValue(undefined),getCompletions:vi.fn().mockResolvedValue([]),getDocumentCompletions:vi.fn().mockResolvedValue({items:[]})}};});
const metadata=vi.hoisted(()=>({getColumns:vi.fn(),getDatabaseColumns:vi.fn()}));
vi.mock("@/services/tauri/schema/catalog",()=>({getColumns:metadata.getColumns}));
vi.mock("@/services/tauri/schema/relations",()=>({getDatabaseColumns:metadata.getDatabaseColumns}));
vi.mock("@/hooks/useLspClient",()=>({useLspClient:()=>({isReady:true,sessionKey:"grid",client:lsp.client,runtime:lsp.runtime})}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("GridFilterRow", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  beforeEach(()=>{
    metadata.getColumns.mockResolvedValue(["status","created_at","name","age"].map(name=>({name,data_type:name==="age"?"integer":"varchar",is_nullable:true,is_primary_key:false})));
    const connection={id:"grid",driver:"postgres",name:"grid"} as any,runtime={status:"connected" as const,updatedAt:1};
    const tab={id:"table-users",type:"table",connectionId:"grid",schemaName:"public",tableName:"users"};
    useConnectionSemanticStore.setState({enabled:false,owner:null,transport:"loading",byConnectionId:{}});
    useConnectionStore.setState({connections:[connection],activeConnectionId:"grid",connectionRuntimeStates:{grid:runtime}});
    useSchemaStore.setState({metadataVersion:1,currentSchema:"public"});useTabStore.setState({tabs:[tab as any]});useProjectStore.setState({activeProjectId:"grid"});
    useLspSemanticStatusStore.setState({byConnectionId:{grid:{state:"full",totalObjects:1,cacheHits:0,cacheMisses:0,failedObjects:0,updatedAt:1,context:{identity:{connection:semanticConnectionToken(connection),runtime,lspRuntime:lsp.runtime.generation,metadataVersion:1,projectId:"grid",currentSchema:"public",routes:{[tab.id]:semanticTabRoute(tab)}},analysisToken:"grid-confirmed",sourcesReady:true,metadataReady:true}}}});
  });

  it("never treats a freshly mapped old result array as newly fetched metadata",async()=>{
    container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
    const resultColumns=[{name:"status"}];
    const render=()=>root!.render(<GridFilterRow columns={resultColumns.map(column=>({id:column.name,title:column.name}))} mode="sql" visualFilters={[]} sqlFilter="" onModeChange={vi.fn()} onVisualFiltersChange={vi.fn()} onSqlFilterChange={vi.fn()} driver="postgres" connectionId="grid" tabId="table-users" schemaName="public" tableName="users"/>);
    await act(async()=>render());const input=container.querySelector("input")!;
    const trigger=()=>{input.focus();input.setSelectionRange(0,0);input.dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,bubbles:true}));};
    await act(async()=>trigger());
    const state=useLspSemanticStatusStore.getState().byConnectionId.grid!;
    metadata.getColumns.mockResolvedValue([{name:"status_new",data_type:"integer",is_nullable:true,is_primary_key:false}]);
    await act(async()=>{useLspSemanticStatusStore.getState().setStatus("grid",{...state,context:{...state.context!,analysisToken:"new-confirmed-token"}});render();});
    await act(async()=>trigger());
    const labels=Array.from(container.querySelectorAll("[role=option] .font-mono")).map(value=>value.textContent);
    expect(labels).not.toContain("status");expect(labels).toContain("status_new");
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
  });

  it("keeps the default WHERE editor compact and applies on Enter", async () => {
    const onSearch = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <GridFilterRow
          columns={[{ id: "name", title: "name", width: 120 }]}
          mode="visual"
          visualFilters={[{ column: "name", operator: "contains", value: "Ada" }]}
          sqlFilter=""
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={vi.fn()}
          onSearch={onSearch}
        />
      );
    });

    expect(container.textContent).toContain("WHERE");
    expect(container.querySelectorAll("input")).toHaveLength(1);

    await act(async () => {
      container
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it("supports a direct SQL WHERE condition without the visual builder", async () => {
    const onModeChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <GridFilterRow
          columns={[]}
          mode="sql"
          visualFilters={[]}
          sqlFilter="status = 'active'"
          onModeChange={onModeChange}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={vi.fn()}
          onSearch={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("SORT");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("WHERE"))
        ?.click();
    });
    expect(onModeChange).toHaveBeenCalledWith("visual");
  });

  it("opens table-column completion with Ctrl+Space and accepts it", async () => {
    const onSqlFilterChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    function Controlled(){const [filter,setFilter]=useState("");return (
        <GridFilterRow
          columns={[
            { id: "status", title: "status", width: 120 },
            { id: "created_at", title: "created_at", width: 120 },
          ]}
          mode="sql"
          visualFilters={[]}
          sqlFilter={filter}
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={value=>{onSqlFilterChange(value);setFilter(value);}}
          onSearch={vi.fn()}
          connectionId="grid"
          driver="postgres"
          tabId="table-users"
          schemaName="public"
          tableName="users"
        />
    );}
    await act(async()=>{root=createRoot(container);root.render(<Controlled/>);});

    const input = container.querySelector("input")!;
    await act(async () => {
      input.focus();input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await act(async () => {
      Array.from(container.querySelectorAll('[role="option"]'))
        .find((option) => option.textContent?.includes("status"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSqlFilterChange).toHaveBeenCalledWith("status = ");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("places the caret inside an accepted LIKE pattern snippet", async () => {
    function ControlledFilterRow() {
      const [filter, setFilter] = useState("name LIKE ");
      return (
        <GridFilterRow
          columns={[
            {
              id: "name",
              title: "name",
              width: 120,
              dataType: "varchar",
            } as never,
          ]}
          mode="sql"
          visualFilters={[]}
          sqlFilter={filter}
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={setFilter}
          onSearch={vi.fn()}
          connectionId="grid"
          driver="postgres"
          tabId="table-users"
          schemaName="public"
          tableName="users"
        />
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(<ControlledFilterRow />);
    });

    const input = container.querySelector("input")!;
    await act(async () => {
      input.focus();input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    const pattern = Array.from(container.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.includes("'%…%'"),
    );
    expect(pattern).toBeDefined();

    await act(async () => {
      pattern?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(input.value).toBe("name LIKE '%%' ");
    expect(input.selectionStart).toBe("name LIKE '%".length);
    expect(input.selectionEnd).toBe("name LIKE '%".length);
  });

  it("appends an IN-list continuation without replacing the current value", async () => {
    function ControlledFilterRow() {
      const [filter, setFilter] = useState("age IN (1");
      return (
        <GridFilterRow
          columns={[
            {
              id: "age",
              title: "age",
              width: 120,
              dataType: "integer",
            } as never,
          ]}
          mode="sql"
          visualFilters={[]}
          sqlFilter={filter}
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={setFilter}
          onSearch={vi.fn()}
          connectionId="grid"
          driver="postgres"
          tabId="table-users"
          schemaName="public"
          tableName="users"
        />
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<ControlledFilterRow />);
    });

    const input = container.querySelector("input")!;
    await act(async () => {
      input.focus();input.setSelectionRange(input.value.length,input.value.length);
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    await act(async () => {
      Array.from(container.querySelectorAll('[role="option"]'))
        .find((option) => option.textContent?.trim().startsWith(","))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(input.value).toBe("age IN (1, ");
    expect(input.selectionStart).toBe(input.value.length);
  });
});
