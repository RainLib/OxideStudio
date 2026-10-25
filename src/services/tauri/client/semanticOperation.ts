import {useConnectionSemanticStore} from "@/services/lsp/connectionSemanticState";
import type {CommandArguments} from "./contracts";

const commands=new Set(["execute_query","execute_read_only_query","execute_native_query_page",
  "fetch_native_query_page","close_native_query_page","import_sql_script","explain_query",
  "begin_transaction","commit_transaction","rollback_transaction","set_current_schema","create_database",
  "execute_database_maintenance","apply_schema_migration"]);

/** Revoke local candidates before IPC, closing the gap before the host's
 * start event reaches this WebView. Host revisions remain authoritative. */
export function beginCommandSemanticOperation(command:string,args:CommandArguments|undefined):()=>void {
  if(!commands.has(command))return ()=>{};
  const request=args?.request as Record<string,unknown>|undefined;
  const id=args?.connectionId??request?.connectionId;
  return typeof id==="string"&&id?useConnectionSemanticStore.getState().beginLocal(id):()=>{};
}
