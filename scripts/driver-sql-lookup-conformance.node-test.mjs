import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import test from "node:test";
import {runDriverConformance} from "./lib/driver-conformance.mjs";
import {tempFixture,removeFixture} from "../tests/helpers/driverConformanceFixture.mjs";

async function fixture(t,options={}) {
  const files=await tempFixture({lookup:true,includeLookupFixture:true,...options});t.after(()=>removeFixture(files.root));
  const run=()=>runDriverConformance({manifestPath:files.manifestPath,fixturePath:files.fixturePath,environment:{MOCKDB_URL:"fixture://lookup",MOCKDB_PASSWORD:"not-for-report"},launchOverride:{command:process.execPath,args:[files.entrypoint]}});
  return {...files,run};
}
test("lookup conformance proves current/scoped defaults and an independent restoration query",async t=>{
  const f=await fixture(t),{report}=await f.run(),checks=report.operations.find(item=>item.operation==="metadata").checks;
  assert(checks.includes("sqlLookupCurrent")&&checks.includes("sqlLookupScoped")&&checks.includes("sqlLookupRestored")&&checks.includes("sqlLookupQueryRestored"));
  for(const privateValue of ["not-for-report","fixture://lookup","SELECT current_lookup",'"main"','"sales"'])assert(!JSON.stringify(report).includes(privateValue));
  assert.equal(report.runnerVersion,"1.3.0");
});
test("a lookup-capable runtime cannot obtain evidence without a lookup fixture",async t=>{
  const f=await fixture(t,{includeLookupFixture:false});await assert.rejects(f.run(),/requires a sqlLookupContext fixture/u);
});
test("a lookup fixture cannot pass when runtime capability is absent",async t=>{
  const f=await fixture(t,{lookup:false});await assert.rejects(f.run(),/did not prove SQL lookup context capability/u);
});
for(const option of ["nullContext","wrongDatabase","wrongSchema","leakMetadata","leakQueryOnly"]) {
  test(`lookup conformance rejects ${option}`,async t=>{
    const f=await fixture(t,{[option]:true});await assert.rejects(f.run(),/lookup context|first row/u);
  });
}
test("lookup restoration rejects a query that resets the database before observing it",async t=>{
  const f=await fixture(t),document=JSON.parse(await readFile(f.fixturePath,"utf8"));document.sqlLookupContext.currentQuery.context.database="main";
  await writeFile(f.fixturePath,JSON.stringify(document));await assert.rejects(f.run(),/without selecting a database or schema/u);
});
test("lookup restoration requires an exact current-context expected row",async t=>{
  const f=await fixture(t),document=JSON.parse(await readFile(f.fixturePath,"utf8"));delete document.sqlLookupContext.currentQuery.expect;
  await writeFile(f.fixturePath,JSON.stringify(document));await assert.rejects(f.run(),/requires the exact/u);
});
test("lookup scope must differ from the initial database",async t=>{
  const f=await fixture(t),document=JSON.parse(await readFile(f.fixturePath,"utf8"));document.sqlLookupContext.databases=[document.sqlLookupContext.current];
  await writeFile(f.fixturePath,JSON.stringify(document));await assert.rejects(f.run(),/distinct/u);
});
