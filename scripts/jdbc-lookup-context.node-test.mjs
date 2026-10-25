import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {mkdtemp,mkdir,writeFile,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve,delimiter,sep} from "node:path";
import {once} from "node:events";
import {createInterface} from "node:readline";
import {fileURLToPath} from "node:url";
import test from "node:test";
const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const javaHome=process.env.OXIDE_JAVA_HOME || process.env.JAVA_HOME;
const javaTool=name=>javaHome?join(javaHome,"bin",process.platform==="win32"?`${name}.exe`:name):name;

test("JDBC lookup context uses engine defaults, scopes catalogs and restores them on success/error",{timeout:45000},async t=>{
  const directory=await mkdtemp(join(tmpdir(),"oxide-jdbc-lookup-"));
  t.after(async()=>{
    const absolute=await realpath(directory),parent=await realpath(tmpdir());
    assert(absolute.startsWith(parent+sep+"oxide-jdbc-lookup-"));await rm(absolute,{recursive:true,force:true});
  });
  const built=spawnSync(process.execPath,["scripts/build-jdbc-driver-agent.mjs",directory],{cwd:root,windowsHide:true,encoding:"utf8"});
  assert.equal(built.status,0,built.stderr);
  const classes=join(directory,"fixture");await mkdir(join(classes,"META-INF","services"),{recursive:true});
  const compiled=spawnSync(javaTool("javac"),["--release","21","-d",classes,"src-tauri/jdbc-agent/tests/LookupContextDriver.java"],{cwd:root,windowsHide:true,encoding:"utf8"});
  assert.equal(compiled.status,0,compiled.stderr);await writeFile(join(classes,"META-INF/services/java.sql.Driver"),"LookupContextDriver\n");
  for (const driver of ["sqlserver","postgres"]) {
    const child=spawn(javaTool("java"),["-cp",[join(directory,"oxide-jdbc-agent.jar"),classes].join(delimiter),"studio.oxide.jdbc.DriverMain"],{cwd:root,windowsHide:true,stdio:["pipe","pipe","pipe"],env:{...process.env,OXIDE_DRIVER_PACKAGE_ID:"oxide.lookup.fixture",OXIDE_DRIVER_PACKAGE_VERSION:"1.0.0",OXIDE_DRIVER_ID:driver}});
    const exit=once(child,"exit");let stderr="";child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-4000);});
    const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let sequence=0;
    const request=async(method,params)=>{
      const id=++sequence;child.stdin.write(JSON.stringify({id,method,params})+"\n");
      const line=await lines.next();assert(!line.done,stderr);const value=JSON.parse(line.value);assert.equal(value.id,id);return value;
    };
    try {
      const handshake=await request("handshake",{});assert.equal(handshake.result.value.capabilities.sqlLookupContext,driver==="sqlserver");
      await request("connect",{connection_id:"c",config:{url:"jdbc:lookup:fixture",options:{}}});
      const lookup=database=>request("metadata",{connection_id:"c",request:{kind:"sqlLookupContext",...(database===undefined?{}:{database})}});
      if (driver!=="sqlserver") {assert.equal((await lookup("db")).result.value,null);continue;}
      for (const database of ["db","db]; -- quoted","中文数据库"]) {
        const scoped=await lookup(database);assert.equal(scoped.status,"ok",JSON.stringify(scoped));
        assert.deepEqual(scoped.result.value,{database,defaultSchema:"default_"+database});
        assert.deepEqual((await lookup()).result.value,{database:"original",defaultSchema:"default_original"});
      }
      for (const database of ["sql_error","multi","mismatch","ignored"]) {
        assert.equal((await lookup(database)).status,"error",database);
        assert.equal((await lookup()).result.value.database,"original",database+": context was not restored");
      }
      assert.equal((await lookup("missing")).result.value,null);
      assert.equal((await lookup()).result.value.database,"original");
    } finally {
      child.stdin.end();const timer=setTimeout(()=>child.kill(),3000);
      await exit;clearTimeout(timer);
    }
  }
});
