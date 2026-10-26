// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useManagedTablePermissions } from "./useManagedTablePermissions";
import type { ConnectionConfig } from "@/features/connections/model/types";
const request=vi.hoisted(()=>vi.fn());
vi.mock("@/services/tauri/enterprise.service",()=>({enterpriseService:{getTablePermissions:request}}));
let root:Root,container:HTMLDivElement,current:ReturnType<typeof useManagedTablePermissions>;
function Harness({connection,table}:{connection:ConnectionConfig;table:string}) { current=useManagedTablePermissions(connection,"fixture","app",table);return null; }
const connection:ConnectionConfig={id:"source",name:"Fixture",driver:"postgres",url:"",origin:"managed"};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;request.mockReset();container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const render=async(table="notes",source=connection)=>act(async()=>root.render(<Harness connection={source} table={table}/>));
describe("managed concrete-table permissions",()=>{
  it("starts disabled and loads the concrete database/schema/table",async()=>{
    let finish!:(value:any)=>void;request.mockReturnValue(new Promise(resolve=>finish=resolve));
    await render();expect(current.permissions).toBeNull();
    expect(request).toHaveBeenCalledWith("source","fixture","app","notes");
    await act(async()=>finish({dataWrite:true,schemaDdl:false,policyRevision:"1"}));
    expect(current.permissions).toMatchObject({dataWrite:true,schemaDdl:false});
  });
  it("never publishes permissions from a previous table",async()=>{
    let finish!:(value:any)=>void;request.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));
    request.mockResolvedValue({dataWrite:false,schemaDdl:true,policyRevision:"2"});
    await render();await render("sandbox");
    await act(async()=>finish({dataWrite:true,schemaDdl:false,policyRevision:"1"}));
    expect(current.permissions).toMatchObject({dataWrite:false,schemaDdl:true});
  });
  it("withdraws permission when the descriptor changes or revalidation fails",async()=>{
    request.mockResolvedValue({dataWrite:true,schemaDdl:false,policyRevision:"1"});await render();
    request.mockRejectedValue(new Error("Permission service unavailable"));
    await render("notes",{...connection});
    expect(current.permissions).toBeNull();expect(current.error).toContain("unavailable");
  });
  it("leaves local connections outside enterprise permission traffic",async()=>{
    await render("notes",{...connection,origin:"local"});expect(request).not.toHaveBeenCalled();
  });
});
