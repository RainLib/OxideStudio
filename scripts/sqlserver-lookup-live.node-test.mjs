import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,access,realpath,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,sep,resolve} from "node:path";
import test from "node:test";
import {sha256Bytes} from "./lib/driver-conformance.mjs";
import {runSqlServerLookupLive} from "./lib/sqlserver-lookup-live.mjs";

async function fixture(t,modes={}) {
  const root=await mkdtemp(join(tmpdir(),"oxide-sqlserver-live-control-"));t.after(async()=>{const path=await realpath(root),temporary=await realpath(tmpdir());assert(path.startsWith(temporary+sep+"oxide-sqlserver-live-control-"));await rm(path,{recursive:true,force:true});});
  const directory=join(root,"package");await mkdir(directory);const bytes=Buffer.from("fixture package bytes");await writeFile(join(directory,"agent.jar"),bytes);
  const manifestPath=join(directory,"manifest.json");await writeFile(manifestPath,JSON.stringify({driverId:"sqlserver",entrypoint:"agent.jar",sha256:sha256Bytes(bytes),runtime:{kind:"java",classpath:[]}}));
  const outputPath=join(root,"evidence.json"),calls=[],id="a".repeat(64);let owner,secret,probeUrl;
  const docker=async(args,options={})=>{
    calls.push({args,options});
    if(args[0]==="pull")return {code:0,output:""};
    if(args[0]==="run"){
      owner=args[args.indexOf("--label")+1].split("=")[1];secret=options.env.MSSQL_SA_PASSWORD;
      if(modes.launchError)throw new Error("launch failed");return {code:0,output:id};
    }
    if(args[0]==="exec")return {code:modes.neverReady?1:0,output:""};
    if(args[0]==="port")return {code:0,output:modes.publicPort?"0.0.0.0:15433":"127.0.0.1:15433"};
    if(args[0]==="inspect")return {code:0,output:JSON.stringify({Id:id,Labels:{"studio.oxide.test.lookup":modes.foreignOwner?"foreign":owner}})};
    if(args[0]==="rm")return {code:0,output:id};
    throw new Error("unexpected Docker command");
  };
  const conformance=async request=>{
    probeUrl=request.environment.OXIDE_SQLSERVER_CONFORMANCE_URL;
    if(modes.conformanceError)throw new Error("conformance failed");return {report:{passed:true,serverVersion:"unit-fixture"}};
  };
  const run=extra=>runSqlServerLookupLive({manifestPath,fixturePath:resolve("tests/driver-conformance/sqlserver-lookup-v1.json"),javaBinary:process.execPath,outputPath,acceptEula:true,docker,conformance,delay:async()=>{},...extra});
  return {run,calls,outputPath,id,secret:()=>secret,probeUrl:()=>probeUrl};
}
test("live control refuses missing license approval before any Docker command",async t=>{
  const f=await fixture(t);await assert.rejects(f.run({acceptEula:false}),/accept-eula/u);assert.equal(f.calls.length,0);
});
test("live control refuses floating image tags before any Docker command",async t=>{
  const f=await fixture(t);await assert.rejects(f.run({image:"mcr.microsoft.com/mssql/server:2022-latest"}),/exact MCR digest/u);assert.equal(f.calls.length,0);
});
test("live control scopes loopback, sends credentials off argv and removes only the owned id",async t=>{
  const f=await fixture(t),result=await f.run();assert(result.report.passed&&result.containerRemoved);
  const run=f.calls.find(c=>c.args[0]==="run");assert(run.args.includes("127.0.0.1::1433"));assert(!run.args.join(" ").includes(f.secret()));
  assert.equal(run.args[run.args.indexOf("--memory")+1],"3g");assert.equal(run.args[run.args.indexOf("--cpus")+1],"2");assert.equal(run.options.timeout,120000);
  assert(f.probeUrl().startsWith("jdbc:sqlserver://127.0.0.1:15433;"));
  const report=await readFile(f.outputPath,"utf8");assert(!report.includes(f.secret())&&!report.includes("password="));
  assert.deepEqual(f.calls.find(c=>c.args[0]==="rm").args,["rm","--force",f.id]);
});
test("live control cleans the owned container after conformance failure without writing evidence",async t=>{
  const f=await fixture(t,{conformanceError:true});await assert.rejects(f.run(),/conformance failed/u);assert(f.calls.some(c=>c.args[0]==="rm"));await assert.rejects(access(f.outputPath));
});
test("live control refuses cleanup if the container ownership label changed",async t=>{
  const f=await fixture(t,{foreignOwner:true});await assert.rejects(f.run(),/ownership changed/u);assert(!f.calls.some(c=>c.args[0]==="rm"));await assert.rejects(access(f.outputPath));
});
test("live control cleans by verified ownership even when launch failed before returning an id",async t=>{
  const f=await fixture(t,{launchError:true});await assert.rejects(f.run(),/launch failed/u);assert(f.calls.some(c=>c.args[0]==="rm"));
});
test("live control refuses a public test port and still cleans the owned container",async t=>{
  const f=await fixture(t,{publicPort:true});await assert.rejects(f.run(),/loopback/u);assert(f.calls.some(c=>c.args[0]==="rm"));
});
test("live control times out readiness and cleans up",async t=>{
  const f=await fixture(t,{neverReady:true});await assert.rejects(f.run(),/readiness deadline/u);assert(f.calls.some(c=>c.args[0]==="rm"));
});

test("progress observer failure cannot prevent container cleanup",async t=>{
  const f=await fixture(t),phases=[];
  const result=await f.run({onPhase:phase=>{phases.push(phase);throw new Error("observer failed");}});
  assert(result.report.passed&&result.containerRemoved);
  assert.deepEqual(phases,["pull","launch","readiness","setup","conformance","cleanup"]);
  assert(f.calls.some(call=>call.args[0]==="rm"));
});
