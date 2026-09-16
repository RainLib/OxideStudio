import type { AiToolAdapters } from "@/ai/tools/types";
import { createConnectionAdapters } from "./connections";
import { createLspAdapters } from "./lsp";
import { createMetadataAdapters } from "./metadata";
import { createMutationAdapters } from "./mutations";
import { createNamespaceAdapters } from "./namespaces";
import { createProjectFileAdapters } from "./projectFiles";
import { createQueryAdapters } from "./queries";
import { createWorkspaceStateAdapters } from "./workspaceState";

export function createWorkspaceAiToolAdapters(): AiToolAdapters {
  return {
    ...createProjectFileAdapters(),
    ...createConnectionAdapters(),
    ...createWorkspaceStateAdapters(),
    ...createMetadataAdapters(),
    ...createQueryAdapters(),
    ...createMutationAdapters(),
    ...createLspAdapters(),
    ...createNamespaceAdapters(),
  };
}
