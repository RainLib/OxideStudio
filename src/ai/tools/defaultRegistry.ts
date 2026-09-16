import { createWorkspaceAiToolAdapters } from "@/ai/tools/workspace/createWorkspaceAdapters";
import { registerCoreAiTools } from "./coreTools";
import type { AiToolFamily } from "./families";
import { createAiToolRegistry } from "./registry";

export type WorkspaceAiToolRegistryOptions = {
  families?: AiToolFamily[];
};

export function createWorkspaceAiToolRegistry(
  options: WorkspaceAiToolRegistryOptions = {},
) {
  return registerCoreAiTools(
    createAiToolRegistry(),
    createWorkspaceAiToolAdapters(),
    options.families,
  );
}

export { createWorkspaceAiToolContext } from "@/ai/tools/workspace/context";
export { createWorkspaceAiToolAdapters } from "@/ai/tools/workspace/createWorkspaceAdapters";
