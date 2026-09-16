import {
  connectionCapabilitiesTool,
  connectionListTool,
} from "@/ai/tools/core/connections";
import {
  deleteDocumentsTool,
  insertDocumentsTool,
  updateDocumentsTool,
} from "@/ai/tools/core/documents";
import {
  deleteKeysTool,
  getKeyValueTool,
  setKeyValueTool,
} from "@/ai/tools/core/keyValues";
import {
  lspCompletionsTool,
  lspExplainDiagnosticsTool,
} from "@/ai/tools/core/lsp";
import {
  describeObjectTool,
  listCollectionsTool,
  listObjectsTool,
} from "@/ai/tools/core/metadata";
import {
  createNamespaceTool,
  dropNamespaceTool,
} from "@/ai/tools/core/namespaces";
import {
  projectListFilesTool,
  projectReadFileTool,
  projectWriteFileTool,
} from "@/ai/tools/core/projectFiles";
import { providerListTool } from "@/ai/tools/core/providers";
import {
  destructiveQueryTool,
  explainQueryTool,
  mutationQueryTool,
  readOnlyQueryTool,
} from "@/ai/tools/core/queries";
import {
  deleteSearchDocumentTool,
  indexSearchDocumentTool,
  updateSearchDocumentTool,
} from "@/ai/tools/core/searchDocuments";
import {
  deleteTableRowsTool,
  insertTableRowsTool,
  updateTableRowsTool,
} from "@/ai/tools/core/tableRows";
import {
  activeTabTool,
  editorPatchTool,
  workspaceSelectionTool,
} from "@/ai/tools/core/workspace";
import type { AiToolFamily } from "./families";
import {
  describeAiToolFamilyAvailability,
  mergeAiToolFamilies,
  registerAiToolFamilies,
} from "./families";
import type { AiToolRegistry } from "./registry";
import type { AiToolAdapters } from "./types";

export const CORE_AI_TOOL_FAMILIES: AiToolFamily[] = [
  {
    name: "project.files",
    requiredAdapters: [
      "listProjectFiles",
      "readProjectFile",
      "writeProjectFile",
    ],
    tools: [projectListFilesTool, projectReadFileTool, projectWriteFileTool],
  },
  {
    name: "connection",
    tools: [connectionListTool, connectionCapabilitiesTool],
  },
  {
    name: "provider.registry",
    tools: [providerListTool],
  },
  {
    name: "workspace",
    requiredAdapters: ["getActiveTab"],
    tools: [activeTabTool],
  },
  {
    name: "workspace.selection",
    requiredAdapters: ["getWorkspaceSelection"],
    tools: [workspaceSelectionTool],
  },
  {
    name: "editor.patch",
    requiredAdapters: ["proposeEditorPatch"],
    tools: [editorPatchTool],
  },
  {
    name: "metadata.collections",
    requiredAdapters: ["listCollections"],
    tools: [listCollectionsTool],
  },
  {
    name: "metadata.objects",
    requiredAdapters: ["listObjects"],
    tools: [listObjectsTool],
  },
  {
    name: "metadata.describe",
    requiredAdapters: ["describeObject"],
    tools: [describeObjectTool],
  },
  {
    name: "query.read",
    requiredAdapters: ["runReadOnlyQuery"],
    tools: [readOnlyQueryTool],
  },
  {
    name: "query.explain",
    requiredAdapters: ["explainQuery"],
    tools: [explainQueryTool],
  },
  {
    name: "query.write",
    requiredAdapters: ["runMutationQuery"],
    tools: [mutationQueryTool, destructiveQueryTool],
  },
  {
    name: "database.namespace",
    requiredAdapters: ["mutateNamespace"],
    tools: [createNamespaceTool, dropNamespaceTool],
  },
  {
    name: "table.rows",
    requiredAdapters: ["mutateTableRows"],
    tools: [insertTableRowsTool, updateTableRowsTool, deleteTableRowsTool],
  },
  {
    name: "document.mutations",
    requiredAdapters: ["mutateDocuments"],
    tools: [insertDocumentsTool, updateDocumentsTool, deleteDocumentsTool],
  },
  {
    name: "keyValue.read",
    requiredAdapters: ["runReadOnlyQuery"],
    tools: [getKeyValueTool],
  },
  {
    name: "keyValue.mutations",
    requiredAdapters: ["mutateKeyValues"],
    tools: [setKeyValueTool, deleteKeysTool],
  },
  {
    name: "search.mutations",
    requiredAdapters: ["mutateSearchDocuments"],
    tools: [
      indexSearchDocumentTool,
      updateSearchDocumentTool,
      deleteSearchDocumentTool,
    ],
  },
  {
    name: "lsp.completion",
    requiredAdapters: ["getLspCompletions"],
    tools: [lspCompletionsTool],
  },
  {
    name: "lsp.diagnostics",
    requiredAdapters: ["explainLspDiagnostics"],
    tools: [lspExplainDiagnosticsTool],
  },
];

export function registerCoreAiTools(
  registry: AiToolRegistry,
  adapters: AiToolAdapters,
  families: AiToolFamily[] = mergeAiToolFamilies(CORE_AI_TOOL_FAMILIES),
) {
  return registerAiToolFamilies(registry, adapters, families);
}

export function describeCoreAiToolEnvironment(
  adapters: AiToolAdapters,
  host: string,
  families: AiToolFamily[] = mergeAiToolFamilies(CORE_AI_TOOL_FAMILIES),
) {
  const availability = describeAiToolFamilyAvailability(families, adapters);

  return {
    host,
    enabledToolFamilies: availability
      .filter((family) => family.enabled)
      .map((family) => family.name),
    disabledToolFamilies: availability
      .filter((family) => !family.enabled)
      .map((family) => ({
        name: family.name,
        toolCount: family.toolCount,
        requiredAdapters: family.requiredAdapters,
        missingAdapters: family.missingAdapters,
      })),
  };
}
