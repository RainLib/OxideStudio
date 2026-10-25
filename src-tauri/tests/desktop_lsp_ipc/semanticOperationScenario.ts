import {getConnectionSemanticState,listenConnectionSemanticState,type ConnectionSemanticState} from "@/services/tauri/semantic-context.service";
import {executeQuery} from "@/services/tauri/query.service";
import {beginTransaction,rollbackTransaction} from "@/services/tauri/transaction.service";
import {getTables} from "@/services/tauri/schema/catalog";

type Environment={check:(value:unknown,message:string)=>asserts value;step:(name:string,action:()=>Promise<void>)=>Promise<void>};
export async function runSemanticOperationAcceptance(environment:Environment) {
  const check:Environment["check"]=environment.check,events:ConnectionSemanticState[]=[];
  const release=await listenConnectionSemanticState(state=>{if(state.connectionId==="semantic-sqlite")events.push(state);});
  try {
    await environment.step("driver-semantic-state-real-sqlite-query-errors-and-transactions",async()=>{
      const before=await getConnectionSemanticState("semantic-sqlite");
      check(before?.connected&&before.activeOperations===0&&before.openTransactions===0,"real SQLite driver initially has an idle semantic state");
      let failed=false;
      try{await executeQuery("semantic-sqlite","CREATE TABLE ledger(id INTEGER); SELECT * FROM missing_table /* private-sql-probe */");}catch{failed=true;}
      check(failed,"production query command reports the actual second statement failure");
      const after=await getConnectionSemanticState("semantic-sqlite");
      check(after!==null&&after.revision>before.revision&&after.activeOperations===0&&!after.uncertain,"a returned SQL error still advances and settles the observed driver operation");
      check((await getTables("semantic-sqlite","main")).some(table=>table.name==="ledger"),"real SQLite committed the first statement before the later error");
      check((await getConnectionSemanticState("semantic-sqlite"))?.revision===after.revision,"metadata discovery does not trigger a semantic invalidation loop");
      await beginTransaction("semantic-sqlite","semantic-tx");
      check((await getConnectionSemanticState("semantic-sqlite"))?.openTransactions===1,"manual transaction remains a separate semantic fence between statements");
      await executeQuery("semantic-sqlite","INSERT INTO ledger VALUES(42)",undefined,"semantic-tx");
      check((await getConnectionSemanticState("semantic-sqlite"))?.openTransactions===1,"query completion cannot erase an open transaction");
      await rollbackTransaction("semantic-sqlite","semantic-tx");
      const settled=await getConnectionSemanticState("semantic-sqlite");
      check(settled!==null&&settled.openTransactions===0&&settled.activeOperations===0&&!settled.uncertain,"rollback closes the observed transaction fence");
      const rows=await executeQuery("semantic-sqlite","SELECT COUNT(*) AS n FROM ledger");
      check(rows[0]?.rows[0]?.[0]===0,"actual rollback preserves the empty table");
      const latest=await getConnectionSemanticState("semantic-sqlite");
      const deadline=Date.now()+10000;
      while((!events.some(state=>state.activeOperations>0)||!events.some(state=>state.revision===latest?.revision))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
      check(events.some(state=>state.activeOperations>0)&&events.some(state=>state.revision===latest?.revision),"actual Tauri events deliver operation start and the current settled revision");
      check(!JSON.stringify(events).includes("private-sql-probe")&&!JSON.stringify(events).includes("INSERT"),"live notifications contain neither SQL nor error text");
      check(events.every((state,index)=>index===0||state.revision>events[index-1]!.revision),"this actual event stream retains monotonically increasing revisions");
    });
  } finally {release();}
  return {realSqlite:true,productionQueryCommand:true,productionTransactionCommands:true,actualTauriEvents:true,
    partialErrorObserved:true,transactionFenceObserved:true,metadataLoop:false,sqlServerRoleVerified:false,
    rendererInvalidationIntegrated:false,eventCount:events.length};
}
