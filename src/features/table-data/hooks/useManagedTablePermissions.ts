import { useEffect, useState } from "react";
import type { ConnectionConfig } from "@/features/connections/model/types";
import { enterpriseService } from "@/services/tauri/enterprise.service";

type Permissions = NonNullable<Awaited<ReturnType<typeof enterpriseService.getTablePermissions>>>;
export function useManagedTablePermissions(connection: ConnectionConfig | undefined, database: string | undefined, schema: string | undefined, table: string | undefined) {
  const identity=JSON.stringify([database,schema,table]);
  const [state,setState]=useState<{connection:ConnectionConfig;identity:string;permissions:Permissions|null;error:string|null}|null>(null);
  useEffect(()=>{
    if(connection?.origin!=="managed"||!schema||!table)return;
    let cancelled=false,busy=false;
    const refresh=async()=>{
      if(busy)return;busy=true;
      try {
        const permissions=await enterpriseService.getTablePermissions(connection.id,database,schema,table);
        if(!cancelled)setState({connection,identity,permissions,error:null});
      } catch(error){
        if(!cancelled)setState({connection,identity,permissions:null,error:error instanceof Error?error.message:String(error)});
      } finally {busy=false;}
    };
    void refresh(); const timer=window.setInterval(()=>void refresh(),30_000);
    const focus=()=>void refresh();window.addEventListener("focus",focus);
    return()=>{cancelled=true;window.clearInterval(timer);window.removeEventListener("focus",focus);};
  },[connection,identity,database,schema,table]);
  const current=state&&state.connection===connection&&state.identity===identity?state:null;
  return {permissions:current?.permissions??null,error:current?.error??null};
}
