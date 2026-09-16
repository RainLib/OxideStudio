import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."); const read=f=>fs.readFileSync(path.join(root,f),"utf8");
const facade=read("src/services/tauri/ai.service.ts");
for(const [module,symbols] of Object.entries({http:["chatCompletion","inlineCompletion","setProviderSecret"],cli:["testProvider","listCliModels","setCliEnvironment"]})) { const source=read(`src/services/tauri/ai/${module}.ts`); if(!facade.includes(`...${module},`)||!source.includes('from "../client"')||source.includes('ai.service')) throw new Error(`AI service ${module} boundary invalid.`); if(symbols.some(s=>!source.includes(s))) throw new Error(`AI service ${module} lost an owner.`); }
if(read("src/services/tauri/ai/contracts.ts").includes("invokeWithInterceptors")) throw new Error("AI contracts must be transport-free.");
console.log("AI service boundaries verified: contracts, HTTP requests, and CLI lifecycle owners are explicit.");
