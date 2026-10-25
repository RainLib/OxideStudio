// Common isolated native-library import runner. No Desktop IPC or saved connections.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
async function hash(file){const digest=createHash("sha256");for await(const chunk of createReadStream(file))digest.update(chunk);return digest.digest("hex");}
async function exists(file){try{await fs.stat(file);return true;}catch(error){if(error.code==="ENOENT")return false;throw error;}}
function memory(pid){
  if(process.platform==="win32")return JSON.parse(execFileSync("powershell",["-NoProfile","-NonInteractive","-Command",`$fixtureProcess=Get-Process -Id ${pid}; @{peakWorkingSetBytes=$fixtureProcess.PeakWorkingSet64;privateMemoryAtMeasurementBytes=$fixtureProcess.PrivateMemorySize64}|ConvertTo-Json -Compress`],{encoding:"utf8",windowsHide:true,timeout:10000}));
  return null;
}
export async function runNativeImportFixture(format){
  assert.ok(["json","xlsx"].includes(format));
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),`oxide-${format}-import-acceptance-`));
  const env={...process.env,CARGO_PROFILE_DEV_DEBUG:"0",CARGO_PROFILE_TEST_DEBUG:"0",CARGO_INCREMENTAL:"0",CARGO_BUILD_JOBS:"4",TAURI_CONFIG:JSON.stringify({bundle:{externalBin:[]}}),[format==="json"?"OXIDE_JSON_IMPORT_EVIDENCE_DIR":"OXIDE_XLSX_IMPORT_EVIDENCE_DIR"]:directory};delete env.PROTOC;
  const nativeEnv={...env,TEMP:directory,TMP:directory,TMPDIR:directory};
  const evidence={platform:`${process.platform}-${process.arch}`,rustVersion:execFileSync("rustc",["--version"],{encoding:"utf8",windowsHide:true}).trim(),success:false,scope:`native-library-${format}-import`,desktopIpcTested:false,resumableImportTested:false};
  let child,completion;
  const start=(command,args,environment,output,error)=>{child=spawn(command,args,{cwd:root,env:environment,windowsHide:true,stdio:["ignore",output,error]});completion=new Promise((resolve,reject)=>{child.once("error",reject);child.once("close",(code,signal)=>resolve({code,signal}));});};
  const waitReady=async(name,minutes)=>{const deadline=Date.now()+minutes*60000;while(!await exists(path.join(directory,name))){assert.ok(child.exitCode===null&&child.signalCode===null,`native test exited before ${name}; inspect logs`);if(Date.now()>deadline)throw new Error(`Native ${format} fixture deadline exceeded`);await new Promise(resolve=>setTimeout(resolve,200));}};
  try {
    const build=await fs.open(path.join(directory,"build.log"),"w"),output=await fs.open(path.join(directory,"build-artifacts.jsonl"),"w");
    try{start("cargo",["test","--locked","--offline","--manifest-path",path.join(root,"src-tauri/Cargo.toml"),"--lib","--no-run","--message-format=json"],env,output.fd,build.fd);assert.equal((await completion).code,0,"native test build failed; inspect build.log");}finally{await build.close();await output.close();}
    let executable;
    for await(const line of createInterface({input:createReadStream(path.join(directory,"build-artifacts.jsonl")),crlfDelay:Infinity})){const item=JSON.parse(line);if(item.reason==="compiler-artifact"&&item.target.name==="oxide_studio_lib"&&item.profile.test&&item.executable)executable=item.executable;}
    assert.ok(executable,"library test executable not emitted");evidence.testExecutableSha256=await hash(executable);
    const log=await fs.open(path.join(directory,"native.log"),"w");
    try{
      start(executable,[`commands::table::tests::import_${format}_stream::${format}_stream_million_row_sqlite_acceptance`,"--ignored","--exact","--nocapture","--test-threads=1"],nativeEnv,log.fd,log.fd);
      await waitReady("measure-ready",format==="xlsx"?20:10);
      evidence.memory=memory(child.pid);
      if(process.platform==="linux"){const status=await fs.readFile(`/proc/${child.pid}/status`,"utf8");evidence.memory={peakWorkingSetBytes:Number(status.match(/^VmHWM:\s+(\d+) kB/m)?.[1])*1024};}
      if(evidence.memory){evidence.fixturePeakWorkingSetBudgetBytes=256*1024*1024;assert.ok(evidence.memory.peakWorkingSetBytes>0&&evidence.memory.peakWorkingSetBytes<=evidence.fixturePeakWorkingSetBudgetBytes,"dataset working-set gate exceeded");}
      await fs.writeFile(path.join(directory,"measure-done"),"done");
      const exit=await completion;assert.equal(exit.code,0,"native import acceptance failed; inspect native.log");
      assert.match(await fs.readFile(path.join(directory,"native.log"),"utf8"),/1 passed; 0 failed; 0 ignored/);
      Object.assign(evidence,JSON.parse(await fs.readFile(path.join(directory,"native-evidence.json"),"utf8")));
      assert.equal(evidence.rows,1000001);assert.equal(evidence.batches,2001);assert.equal(evidence.sourceUnchanged,true);assert.ok(evidence.sourceBytes>32*1024*1024);
      if(format==="xlsx")assert.equal(evidence.allPayloadsVerified,true);
      else assert.equal(evidence.preflightRows,1000001);
      assert.equal(await exists(path.join(directory,`million.${format}`)),false);assert.equal(await exists(path.join(directory,"target.db")),false);
      evidence.exitCode=exit.code;evidence.fixtureFilesRemoved=true;
    }finally{await log.close();}
    if(format==="xlsx"){
      const log=await fs.open(path.join(directory,"crash.log"),"w");
      const baseline=new Set(await fs.readdir(directory));
      try {
        start(executable,["commands::table::tests::import_xlsx_stream::xlsx_stream_anonymous_spool_crash_probe","--ignored","--exact","--nocapture","--test-threads=1"],nativeEnv,log.fd,log.fd);
        await waitReady("crash-ready.json",1);
        const marker=JSON.parse(await fs.readFile(path.join(directory,"crash-ready.json"),"utf8"));
        const source=path.resolve(marker.source),sourceDirectory=path.dirname(source),relative=path.relative(directory,source);
        assert.ok(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative),"crash source must be inside fixture");
        assert.equal(path.dirname(sourceDirectory),directory);assert.equal(path.basename(source),"source.xlsx");
        const sourceStat=await fs.lstat(sourceDirectory);assert.ok(sourceStat.isDirectory()&&!sourceStat.isSymbolicLink());
        const active=(await fs.readdir(directory)).filter(name=>!baseline.has(name)&&name!=="crash-ready.json"&&path.join(directory,name)!==sourceDirectory);
        if(process.platform==="win32")assert.ok(active.length>=2,"shared-string temporary handles must still be live");
        assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);child.kill();const exit=await completion;
        assert.ok(exit.code!==0||exit.signal,"crash probe must not complete normally");
        await fs.unlink(source);await fs.rmdir(sourceDirectory);
        const deadline=Date.now()+5000;
        let extras;
        do {extras=(await fs.readdir(directory)).filter(name=>!baseline.has(name)&&name!=="crash-ready.json");if(!extras.length)break;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);
        assert.deepEqual(extras,[],"anonymous shared-string files survived process termination");
        evidence.crashProbe={liveTemporaryEntries:active.length,exitCode:exit.code,signal:exit.signal,anonymousSpoolCleanup:true,sourceFixtureRemoved:true};
      }finally{await log.close();}
    }
    evidence.success=true;
  }catch(error){evidence.error=error.stack??String(error);process.exitCode=1;}
  finally{
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await completion;}
    await fs.writeFile(path.join(directory,"evidence.json"),JSON.stringify(evidence,null,2)+"\n");
    console.log(JSON.stringify({evidence:path.join(directory,"evidence.json"),...evidence},null,2));
  }
}
