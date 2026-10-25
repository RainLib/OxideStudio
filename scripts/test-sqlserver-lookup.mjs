import {resolve} from "node:path";
import {runSqlServerLookupLive,SQLSERVER_LOOKUP_IMAGE} from "./lib/sqlserver-lookup-live.mjs";
function option(name){const index=process.argv.indexOf(name);if(index<0||!process.argv[index+1]||process.argv[index+1].startsWith("--"))throw new Error(name+" is required");return process.argv[index+1];}
if(process.argv.includes("--help")){
  console.log("Usage: node scripts/test-sqlserver-lookup.mjs --manifest <unsigned-review-package/manifest.json> --java <java21.exe> --out <new-evidence.json> --accept-eula");
  console.log("Image: "+SQLSERVER_LOOKUP_IMAGE);console.log("License: https://learn.microsoft.com/en-us/sql/linux/install-upgrade/quickstart-install-docker?view=sql-server-ver16");
}else{
  runSqlServerLookupLive({manifestPath:resolve(option("--manifest")),fixturePath:resolve("tests/driver-conformance/sqlserver-lookup-v1.json"),javaBinary:resolve(option("--java")),outputPath:resolve(option("--out")),acceptEula:process.argv.includes("--accept-eula"),onPhase:phase=>console.log(JSON.stringify({phase}))}).then(result=>console.log(JSON.stringify({passed:result.report.passed,serverVersion:result.report.serverVersion,containerRemoved:result.containerRemoved,image:result.image}))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
