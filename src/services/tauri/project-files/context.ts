import { invokeRawCommand } from "../client";
import type { ProjectCompletionSnippet, ProjectLspDocument } from "./contracts";
import { expectedRootArgument, normalizeProjectRelativePath, requireProjectId } from "./path";

export const projectContextService = {
  getCompletionContext: async (options: {
    projectId: string;
    expectedRoot?: string | null;
    activeFile?: string;
    query: string;
    referencedObjects?: string[];
  }): Promise<ProjectCompletionSnippet[]> => {
    return await invokeRawCommand<ProjectCompletionSnippet[]>(
      "get_project_completion_context",
      {
        request: {
          projectId: requireProjectId(options.projectId),
          expectedRoot: options.expectedRoot || null,
          activeFile: options.activeFile
            ? normalizeProjectRelativePath(options.activeFile)
            : null,
          query: options.query.slice(-8_192),
          referencedObjects: options.referencedObjects || [],
        },
      },
    );
  },

  getLspDocuments: async (options: {
    projectId: string;
    expectedRoot?: string | null;
  }): Promise<ProjectLspDocument[]> => {
    return await invokeRawCommand<ProjectLspDocument[]>(
      "get_project_lsp_documents",
      {
        request: {
          projectId: requireProjectId(options.projectId),
          ...expectedRootArgument(options.expectedRoot),
        },
      },
    );
  },

};
