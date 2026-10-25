// Isolated production file UI -> real Tauri -> signed DuckDB Host acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {matchesSqlLspSourceFingerprint} from './lib/sql-lsp-build-inputs.mjs';
assert.equal(process.argv.length,2);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'oxide-desktop-file-query-'));
console.log(JSON.stringify({directory,stage:'preparing-signed-host-webview'}));
const env={...process.env,CARGO_PROFILE_DEV_DEBUG:'0',CARGO_PROFILE_TEST_DEBUG:'0',CARGO_INCREMENTAL:'0',CARGO_BUILD_JOBS:'4',TAURI_CONFIG:JSON.stringify({bundle:{externalBin:[]}})};
for(const key of Object.keys(env))if(/^(TAURI_SIGNING_|OXIDE_DRIVER_SIGNING_|OXIDE_FILE_QUERY_TEST_)/u.test(key))delete env[key];delete env.PROTOC;delete env.OXIDE_SQL_LSP_BINARY;
const key=path.join(directory,'ephemeral.key'),cli=path.join(root,'node_modules/@tauri-apps/cli/tauri.js');
const evidence={success:false,scope:'production-file-sidebar-dialog-editor-grid-and-signed-host-through-real-tauri',nativePickerSelectionTested:false,installedPackageTested:false};
const sha=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');let child;
async function run(command,args,name,timeout=240000,quiet=false,environment=env,cwd=root){
 const file=await fs.open(path.join(directory,name+'.log'),'w');try{child=spawn(command,args,{cwd,env:environment,windowsHide:true,stdio:['ignore',quiet?'ignore':file.fd,quiet?'ignore':file.fd]});const owned=child;let expired=false;const timer=setTimeout(()=>{expired=true;owned.kill();},timeout);
 try{const code=await new Promise((resolve,reject)=>{owned.once('error',reject);owned.once('close',resolve);});assert(!expired,`${name} deadline exceeded`);assert.equal(code,0,`${name} failed; inspect ${path.join(directory,name+'.log')}`);}finally{clearTimeout(timer);}}finally{await file.close();}
}
try{
 const lsp=path.join(root,'src-tauri/binaries',process.platform==='win32'?'sql-lsp.exe':'sql-lsp'),manifest=JSON.parse(await fs.readFile(lsp+'.manifest.json','utf8'));evidence.lspBinarySha256=await sha(lsp);assert.equal(evidence.lspBinarySha256,manifest.sha256);assert.equal(manifest.profile,'release');assert(matchesSqlLspSourceFingerprint(manifest.sourceFingerprint,path.join(root,'vendor/sql-lsp')));evidence.lspSourceFingerprint=manifest.sourceFingerprint;
 await run(process.platform==='win32'?(env.ComSpec||'cmd.exe'):'npm',process.platform==='win32'?['/d','/s','/c','npm run build']:['run','build'],'production-build');
 const driverManifest=path.join(root,'src-tauri/crates/oxide-driver-duckdb/Cargo.toml'),driverTarget=path.join(root,'src-tauri/crates/oxide-driver-duckdb/target');
 await run('cargo',['build','--manifest-path',driverManifest,'--locked','--offline'],'build-driver',900000,false,{...env,CARGO_TARGET_DIR:driverTarget});
 const driver=path.join(driverTarget,'debug',process.platform==='win32'?'oxide-driver-duckdb.exe':'oxide-driver-duckdb');evidence.driverSha256=await sha(driver);
 await run(process.execPath,[cli,'signer','generate','--ci','-p','','-w',key],'generate-key',120000,true);
 env.OXIDE_DRIVER_SIGNING_PUBLIC_KEY=Buffer.from((await fs.readFile(key+'.pub','utf8')).trim(),'base64').toString('utf8').trim();assert(env.OXIDE_DRIVER_SIGNING_PUBLIC_KEY.startsWith('untrusted comment:'));
 const target=execFileSync('rustc',['-vV'],{encoding:'utf8',windowsHide:true}).match(/^host:\s*(.+)$/mu)?.[1]?.trim();assert(target);
 const destination=path.join(directory,'signed-drivers','duckdb','0.1.0');await run(process.execPath,['scripts/package-duckdb-driver.mjs','--target',target,'--binary',driver,'--version','0.1.0','--out',destination],'package-driver');
 const driverManifestFile=path.join(destination,'manifest.json');await run(process.execPath,[cli,'signer','sign','-f',key,'-p','',driverManifestFile],'sign-driver');await fs.writeFile(driverManifestFile+'.minisig',Buffer.from((await fs.readFile(driverManifestFile+'.sig','utf8')).trim(),'base64').toString('utf8'));
 await fs.unlink(key);evidence.ephemeralPrivateKeyRemovedBeforeLaunch=true;
 await run(process.execPath,['node_modules/typescript/bin/tsc','--project','src-tauri/tests/desktop_file_query_ipc/tsconfig.json','--noEmit'],'typescript');
 const result=await build({entryPoints:[path.join(root,'src-tauri/tests/desktop_file_query_ipc/scenario.tsx')],outfile:path.join(directory,'scenario.js'),bundle:true,platform:'browser',format:'iife',target:'chrome120',tsconfig:path.join(root,'tsconfig.json'),define:{'import.meta.env':JSON.stringify({DEV:false,PROD:true,MODE:'production',BASE_URL:'/'})},loader:{'.ttf':'file','.woff':'file','.woff2':'file'},assetNames:'[name]-[hash]',metafile:true,banner:{js:"window.addEventListener('error',event=>{if(event instanceof ErrorEvent)void window.__TAURI_INTERNALS__?.invoke('acceptance_finish',{report:{success:false,error:'WebView script error: '+event.message}});});"}});
 await fs.writeFile(path.join(directory,'frontend-inputs.json'),JSON.stringify(result.metafile,null,2));
 const index=await fs.readFile(path.join(root,'dist/index.html'),'utf8'),styles=[...index.matchAll(/<link[^>]+href="([^"]+\.css)"/gu)].map(match=>match[1]);assert(styles.length>0);
 await fs.writeFile(path.join(directory,'app.css'),(await Promise.all(styles.map(file=>{assert(/^\/assets\/[a-zA-Z0-9_.-]+\.css$/u.test(file));return fs.readFile(path.join(root,'dist',file.slice(1)),'utf8');}))).join('\n'));
 await run('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--locked','--offline','--test','desktop_file_query_ipc','--no-run','--message-format=json'],'build-native',900000);
 const artifacts=(await fs.readFile(path.join(directory,'build-native.log'),'utf8')).split(/\r?\n/u).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).filter(item=>item.reason==='compiler-artifact'&&item.target?.name==='desktop_file_query_ipc'&&item.executable);assert.equal(artifacts.length,1);
 evidence.executableSha256=await sha(artifacts[0].executable);evidence.scenarioSha256=await sha(path.join(directory,'scenario.js'));
 await run(artifacts[0].executable,['--run-native-ipc',directory],'native',240000,false,env,path.join(root,'src-tauri'));
 const receipt=JSON.parse(await fs.readFile(path.join(directory,'receipt.json'),'utf8'));assert(receipt.success);assert.equal(receipt.receipts.length,6);assert.equal(receipt.formats,4);assert(receipt.assertions>=120);for(const key of ['physicalHoverAndWidget','scopedLocalHover','scopedLocalOutline','scopedLocalNavigation','warmCatalogRetained','controlledConfirmationHold','formatWaitsForPreferences','localCompletionDuringConfirmation','automaticLocalWidgetRecovery','localSuffixAcceptance','physicalCompletionRestored','logicalScalarCoercion','analyticPredicateResults','patternResults','escapedPatternResults','patternLogicalContinuations'])assert.equal(receipt.semantics[key],true);evidence.receipt=receipt;evidence.success=true;
}catch(error){evidence.error=error.stack??String(error);process.exitCode=1;}finally{
 if(child?.exitCode===null&&child.signalCode===null)child.kill();for(const file of [key,key+'.pub'])await fs.unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
 evidence.ephemeralKeysRemoved=true;await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({directory,...evidence},null,2));
}
