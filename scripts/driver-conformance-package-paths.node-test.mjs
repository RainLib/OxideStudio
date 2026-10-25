import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,sep} from "node:path";
import test from "node:test";
import {runDriverConformance,sha256Bytes} from "./lib/driver-conformance.mjs";

const sidecar=String.raw`
const rl=require('node:readline').createInterface({input:process.stdin});
rl.on('line',line=>{const m=JSON.parse(line),p=m.params||{};let r;
if(m.method==='handshake')r={kind:'handshake',value:{protocolVersion:'1.0',packageId:'oxide.paths',packageVersion:'1.0.0',driverId:'paths',capabilities:{query:true}}};
else if(m.method==='ping')r={kind:'boolean',value:true};
else if(m.method==='serverVersion')r={kind:'serverVersion',value:'1.0'};
else if(m.method==='query'&&p.statement==='bad'){console.log(JSON.stringify({id:m.id,status:'error',result:{code:'QUERY_FAILED'}}));return;}
else if(m.method==='query')r={kind:'query',value:[{columns:[{name:'n'}],rows:[[42]]}]};
else r={kind:'empty',value:null};
console.log(JSON.stringify({id:m.id,status:'ok',result:r}));if(m.method==='shutdown')setImmediate(()=>process.exit(0));});`;

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),"oxide-conformance-paths-")),directory=join(root,"package");await mkdir(directory);
  t.after(async()=>{const target=await realpath(root),parent=await realpath(tmpdir());assert(target.startsWith(parent+sep+"oxide-conformance-paths-"));await rm(target,{recursive:true,force:true});});
  const entrypoint=join(directory,"sidecar.js"),outside=join(root,"outside.js");await writeFile(entrypoint,sidecar);await writeFile(outside,sidecar);
  const manifest={schemaVersion:1,packageId:"oxide.paths",packageVersion:"1.0.0",protocolVersion:"1.0",driverId:"paths",entrypoint:"sidecar.js",sha256:sha256Bytes(Buffer.from(sidecar)),capabilities:{supportsSqlQuery:true}};
  const fixturePath=join(root,"fixture.json"),manifestPath=join(directory,"manifest.json");
  await writeFile(fixturePath,JSON.stringify({schemaVersion:1,id:"paths",driverId:"paths",connection:{defaultUrl:"fixture://local"},query:{statement:"SELECT ?",parameters:[42],expect:{minRows:1,firstRow:[42]}},errorMapping:{statement:"bad",expectedCodes:["QUERY_FAILED"]}}));
  const run=async()=>{await writeFile(manifestPath,JSON.stringify(manifest));return runDriverConformance({manifestPath,fixturePath,launchOverride:{command:process.execPath,args:[entrypoint]}});};
  return {root,directory,manifest,entrypoint,outside,run};
}
test("conformance refuses an entrypoint outside the package even when its digest matches",async t=>{
  const f=await fixture(t);f.manifest.entrypoint="../outside.js";
  await assert.rejects(f.run(),/escapes|relative|unsafe/iu);
});
test("conformance validates Java classpath containment even with a launch override",async t=>{
  const f=await fixture(t);f.manifest.runtime={kind:"java",javaMajor:21,mainClass:"fixture.Main",classpath:[{path:"../outside.js",sha256:f.manifest.sha256}]};
  await assert.rejects(f.run(),/escapes|relative|unsafe/iu);
});
test("conformance rejects a directory junction inside the package",async t=>{
  const f=await fixture(t),external=join(f.root,"external");await mkdir(external);await writeFile(join(external,"sidecar.js"),sidecar);
  await symlink(external,join(f.directory,"linked"),process.platform==="win32"?"junction":"dir");f.manifest.entrypoint="linked/sidecar.js";
  await assert.rejects(f.run(),/symbolic|symlink|link/iu);
});
test("conformance still runs a complete package after checking its files",async t=>{
  const f=await fixture(t);assert.equal((await f.run()).report.passed,true);
  assert.equal(sha256Bytes(await readFile(f.entrypoint)),f.manifest.sha256);
});
test("conformance rejects Windows and POSIX parent/root path forms before reading them",async t=>{
  const f=await fixture(t);
  for(const entrypoint of ["..\\outside.js","nested/../../outside.js","C:\\outside.js","/outside.js","./sidecar.js",""]) {
    f.manifest.entrypoint=entrypoint;await assert.rejects(f.run(),/relative|unsafe|escapes/iu);
  }
});
test("conformance checks classpath digests even when the entrypoint is unchanged",async t=>{
  const f=await fixture(t);await mkdir(join(f.directory,"lib"));await writeFile(join(f.directory,"lib/vendor.jar"),"changed vendor");
  f.manifest.runtime={kind:"java",mainClass:"fixture.Main",classpath:[{path:"lib/vendor.jar",sha256:"0".repeat(64)}]};
  await assert.rejects(f.run(),/Java classpath SHA-256/u);
});
test("conformance refuses a directory used as an entrypoint",async t=>{
  const f=await fixture(t);await mkdir(join(f.directory,"directory"));f.manifest.entrypoint="directory";
  await assert.rejects(f.run(),/regular package file/u);
});
test("conformance accepts a normal nested classpath file with spaces",async t=>{
  const f=await fixture(t);await mkdir(join(f.directory,"lib"));const bytes=Buffer.from("reviewed vendor");await writeFile(join(f.directory,"lib/vendor library.jar"),bytes);
  f.manifest.runtime={kind:"java",mainClass:"fixture.Main",classpath:[{path:"lib/vendor library.jar",sha256:sha256Bytes(bytes)}]};
  assert.equal((await f.run()).report.passed,true);
});
