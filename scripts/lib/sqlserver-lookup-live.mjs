import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {readFile,writeFile,access} from "node:fs/promises";
import {dirname} from "node:path";
import {runDriverConformance} from "./driver-conformance.mjs";
import {validateDriverPackageFiles} from "./driver-package-files.mjs";

export const SQLSERVER_LOOKUP_IMAGE = "mcr.microsoft.com/mssql/server@sha256:cf8f0ab2ebe61feec2eed2629061a07d247f791c2a8ddda74a4ac9f06a291718";
const OWNER_LABEL="studio.oxide.test.lookup";

function command(args,{env,input,allowFailure=false,timeout=30000}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn("docker",args,{env:{...process.env,...env},windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let output="";child.stdout.on("data",bytes=>{output=(output+bytes).slice(-1024*1024);});
    // Engine/SQL errors can contain query inputs. Never persist or forward them.
    child.stderr.resume();let terminal=false,timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},timeout);
    child.once("error",()=>{if(terminal)return;terminal=true;clearTimeout(timer);reject(new Error("Docker command could not be started"));});
    child.once("close",code=>{if(terminal)return;terminal=true;clearTimeout(timer);if(code===0||allowFailure)resolve({code,output});else reject(new Error("Docker "+args[0]+(timedOut?" deadline exceeded":" failed (exit "+code+")")));});
    child.stdin.on("error",()=>{});child.stdin.end(input);
  });
}

function setupSql(password) {
  // This script is only sent to a newly created, owned disposable container.
  // Its fixed databases/login are never created on a supplied external server.
  return `CREATE DATABASE oxide_lsp_primary;
GO
CREATE DATABASE oxide_lsp_secondary;
GO
CREATE LOGIN oxide_lsp_probe WITH PASSWORD=N'${password}', CHECK_POLICY=OFF, DEFAULT_DATABASE=oxide_lsp_primary;
GO
USE oxide_lsp_primary;
GO
CREATE SCHEMA sales;
GO
CREATE USER oxide_lsp_probe FOR LOGIN oxide_lsp_probe WITH DEFAULT_SCHEMA=sales;
GRANT SELECT ON SCHEMA::sales TO oxide_lsp_probe;
GRANT SELECT ON SCHEMA::dbo TO oxide_lsp_probe;
CREATE TABLE sales.ledger(id bigint NOT NULL PRIMARY KEY,label nvarchar(64) NOT NULL);
INSERT INTO sales.ledger VALUES(42,N'oxide');
CREATE TABLE dbo.ledger(id bigint NOT NULL PRIMARY KEY,label nvarchar(64) NOT NULL);
INSERT INTO dbo.ledger VALUES(42,N'wrong-schema');
GO
USE oxide_lsp_secondary;
GO
CREATE SCHEMA reporting;
GO
CREATE USER oxide_lsp_probe FOR LOGIN oxide_lsp_probe WITH DEFAULT_SCHEMA=reporting;
GRANT SELECT ON SCHEMA::reporting TO oxide_lsp_probe;
CREATE TABLE reporting.ledger(id bigint NOT NULL PRIMARY KEY,label nvarchar(64) NOT NULL);
INSERT INTO reporting.ledger VALUES(42,N'other-database');
GO
`;
}

export async function runSqlServerLookupLive({manifestPath,fixturePath,javaBinary,outputPath,acceptEula=false,image=SQLSERVER_LOOKUP_IMAGE,docker=command,conformance=runDriverConformance,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onPhase=()=>{}}) {
  const phase=name=>{try{onPhase(name);}catch{/* Progress reporting cannot interrupt owned-container cleanup. */}};
  if(!acceptEula)throw new Error("Explicit --accept-eula is required before starting SQL Server Developer; review Microsoft's SQL Server container license terms");
  if(!/^mcr\.microsoft\.com\/mssql\/server@sha256:[a-f0-9]{64}$/u.test(image))throw new Error("SQL Server test image must be an exact MCR digest");
  const manifest=JSON.parse(await readFile(manifestPath,"utf8"));
  if(manifest.driverId!=="sqlserver"||manifest.runtime?.kind!=="java")throw new Error("SQL Server lookup test requires a SQL Server JDBC package");
  // runDriverConformance validates the actual package closure again. Preflight
  // its package before allocating a container as well.
  await validateDriverPackageFiles(manifest,dirname(manifestPath));
  await access(javaBinary);
  const fixture=JSON.parse(await readFile(fixturePath,"utf8"));
  if(fixture.driverId!=="sqlserver"||!fixture.sqlLookupContext)throw new Error("SQL Server lookup fixture is required");
  try {await access(outputPath);throw new Error("Refusing to overwrite existing live conformance evidence");}catch(error){if(error.code!=="ENOENT")throw error;}
  const owner=randomBytes(12).toString("hex"),name="oxide-lsp-lookup-"+owner;
  const adminPassword=randomBytes(24).toString("hex")+"Aa1!",probePassword=randomBytes(24).toString("hex")+"Aa1!";
  let id,launchAttempted=false,report,cleaned=false;
  try {
    phase("pull");
    await docker(["pull",image],{timeout:20*60000});
    phase("launch");
    launchAttempted=true;
    const launch=await docker(["run","--detach","--rm","--name",name,"--label",OWNER_LABEL+"="+owner,"--memory","3g","--cpus","2","--env","MSSQL_MEMORY_LIMIT_MB=2048","--env","ACCEPT_EULA=Y","--env","MSSQL_PID=Developer","--env","MSSQL_SA_PASSWORD","--publish","127.0.0.1::1433",image],{env:{MSSQL_SA_PASSWORD:adminPassword},timeout:120000});
    id=launch.output.trim();if(!/^[a-f0-9]{64}$/u.test(id))throw new Error("Docker did not return a valid owned container id");
    const sqlArgs=["exec","--interactive","--env","SQLCMDPASSWORD",id,"/opt/mssql-tools18/bin/sqlcmd","-S","localhost","-U","sa","-C","-b","-l","2"];
    phase("readiness");let ready=false;
    for(let attempt=0;attempt<90;attempt++){
      const result=await docker(sqlArgs,{env:{SQLCMDPASSWORD:adminPassword},input:"SELECT 1;\nGO\n",allowFailure:true,timeout:5000});
      if(result.code===0){ready=true;break;}await delay(1000);
    }
    if(!ready)throw new Error("SQL Server readiness deadline exceeded");
    phase("setup");await docker(sqlArgs,{env:{SQLCMDPASSWORD:adminPassword},input:setupSql(probePassword),timeout:60000});
    const port=(await docker(["port",id,"1433/tcp"])).output.trim().match(/^127\.0\.0\.1:(\d+)$/u)?.[1];
    if(!port)throw new Error("SQL Server test port is not bound exclusively to loopback");
    const url=`jdbc:sqlserver://127.0.0.1:${port};databaseName=oxide_lsp_primary;user=oxide_lsp_probe;password=${probePassword};encrypt=true;trustServerCertificate=true;loginTimeout=10`;
    phase("conformance");({report}=await conformance({manifestPath,fixturePath,javaBinary,environment:{OXIDE_SQLSERVER_CONFORMANCE_URL:url}}));
  } finally {
    if(launchAttempted){
      phase("cleanup");
      const inspected=await docker(["inspect",name,"--format",'{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}'],{allowFailure:true});
      if(inspected.code===0){
        let container;try{container=JSON.parse(inspected.output);}catch{throw new Error("Cannot verify disposable SQL Server ownership for cleanup");}
        if(container.Labels?.[OWNER_LABEL]!==owner||!/^[a-f0-9]{64}$/u.test(container.Id))throw new Error("Disposable SQL Server ownership changed; refusing cleanup");
        await docker(["rm","--force",container.Id]);cleaned=true;
      }else{
        const remaining=await docker(["ps","--all","--filter","name=^/"+name+"$","--format","{{.ID}}"]);
        if(remaining.output.trim())throw new Error("Owned SQL Server cleanup could not be verified: "+name);
        cleaned=true;
      }
    }
  }
  if(!report?.passed||!cleaned)throw new Error("Live SQL Server conformance did not complete and clean up");
  await writeFile(outputPath,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
  return {report,containerRemoved:cleaned,image};
}
