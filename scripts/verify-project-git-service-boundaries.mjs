import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/services/tauri/project-git.service.ts");

for (const [module, owner, symbols] of [
  ["repository", "projectGitRepositoryService", ["getRepository", "stage", "push"]],
  ["diff", "projectGitDiffService", ["getPatch", "getFileVersions", "applyPatch"]],
  ["github", "projectGitHubService", ["getGitHubStatus", "authenticateGitHub", "clone"]],
]) {
  const source = read(`src/services/tauri/project-git/${module}.ts`);
  if (
    !facade.includes(owner) ||
    !source.includes('from "../client"') ||
    source.includes("project-git.service") ||
    symbols.some((symbol) => !source.includes(symbol))
  ) {
    throw new Error(`Project Git ${module} boundary is invalid.`);
  }
}

const paths = read("src/services/tauri/project-git/paths.ts");
if (paths.includes("invokeRawCommand") || !paths.includes("normalizeProjectRelativePath")) {
  throw new Error("Project Git path validation must remain transport-free.");
}

console.log("Project Git service boundaries verified: repository, diff, GitHub, and path owners are explicit.");
