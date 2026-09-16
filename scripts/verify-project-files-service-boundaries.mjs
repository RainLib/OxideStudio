import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const facade=read("src/services/tauri/project-files.service.ts");
for(const [module,symbols] of Object.entries({git:["getGitChanges","getGitFileDiff"],context:["getCompletionContext","getLspDocuments"],files:["setProjectRoot","writeProjectFile","deleteProjectFileIfRevision"]})){
 const source=read(`src/services/tauri/project-files/${module}.ts`);
 if(!facade.includes(`project${module[0].toUpperCase()+module.slice(1)}Service`) || !source.includes('from "../client"') || source.includes('project-files.service')) throw new Error(`Project-files ${module} boundary is invalid.`);
 if(symbols.some(symbol=>!source.includes(symbol))) throw new Error(`Project-files ${module} lost an owner.`);
}
const pathSource=read("src/services/tauri/project-files/path.ts");
if(pathSource.includes('invokeRawCommand')) throw new Error("Project-file path validation must remain transport-free.");
console.log("Project-files service boundaries verified: path contract plus Git, context, and file-tree owners are explicit.");
