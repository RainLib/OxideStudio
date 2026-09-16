import { invokeRawCommand } from "../client";
import type {
  AgentArtifactExportResult,
  AgentArtifactReadResult,
  AgentArtifactSearchResult,
  AgentTextAttachment,
} from "./contracts";

export async function importAgentTextAttachment(): Promise<AgentTextAttachment | null> {
  return await invokeRawCommand<AgentTextAttachment | null>(
    "agent_import_text_attachment",
  );
}

export async function readAgentArtifact(request: {
  projectId: string;
  artifactId: string;
  offset?: number;
  maxBytes?: number;
}): Promise<AgentArtifactReadResult> {
  return await invokeRawCommand<AgentArtifactReadResult>(
    "agent_read_artifact",
    { request },
  );
}

export async function searchAgentArtifact(request: {
  projectId: string;
  artifactId: string;
  query: string;
  maxMatches?: number;
  contextBytes?: number;
}): Promise<AgentArtifactSearchResult> {
  return await invokeRawCommand<AgentArtifactSearchResult>(
    "agent_search_artifact",
    { request },
  );
}

export async function exportAgentArtifact(request: {
  projectId: string;
  artifactId: string;
  suggestedFileName?: string | null;
}): Promise<AgentArtifactExportResult> {
  return await invokeRawCommand<AgentArtifactExportResult>(
    "agent_export_artifact",
    { request },
  );
}
