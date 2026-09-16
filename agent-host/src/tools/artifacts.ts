import { DynamicStructuredTool } from "@langchain/core/tools";
import {
  SIDECAR_METHODS,
  artifactReadRequestSchema,
  artifactReadResultSchema,
  artifactSearchRequestSchema,
  artifactSearchResultSchema,
} from "@oxide/agent-contract";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TurnExecution } from "../runtime/execution.js";
import { toolInvocationId } from "./identity.js";
import { safeErrorMessage } from "./observations.js";

export function createContextArtifactTools(execution: TurnExecution) {
  const readArtifact = new DynamicStructuredTool({
    name: "context_read_artifact",
    description:
      "Read one bounded UTF-8 JSON range from an encrypted artifactRef returned by a previous tool. Use offset 0 first, then continue with nextOffset until eof.",
    schema: z.object({
      artifactRef: z.string().min(1).max(240),
      offset: z.number().int().nonnegative().default(0),
      maxBytes: z
        .number()
        .int()
        .positive()
        .max(64 * 1024)
        .default(32 * 1024),
    }),
    func: async ({ artifactRef, offset, maxBytes }, _runManager, config) =>
      invokeContextArtifactTool(
        execution,
        "context_read_artifact",
        toolInvocationId(config),
        async () => {
          const request = artifactReadRequestSchema.parse({
            ...execution.metadataFor(`artifact-read:${artifactRef}:${offset}`),
            projectId: execution.params.projectId,
            artifactId: artifactRef,
            offset,
            maxBytes,
          });
          const result = artifactReadResultSchema.parse(
            await execution.peer.call<unknown>(
              SIDECAR_METHODS.artifactRead,
              request,
              execution.remainingMs(),
            ),
          );
          if (result.encoding === "base64-json" && result.content) {
            return {
              ...result,
              encoding: "utf8-json-fragment",
              content: Buffer.from(result.content, "base64url").toString(
                "utf8",
              ),
            };
          }
          return result;
        },
      ),
  });
  const searchArtifact = new DynamicStructuredTool({
    name: "context_search_artifact",
    description:
      "Search an encrypted artifactRef for a bounded set of JSON text matches before reading a specific range.",
    schema: z.object({
      artifactRef: z.string().min(1).max(240),
      query: z.string().trim().min(1).max(256),
      maxMatches: z.number().int().positive().max(20).default(8),
      contextBytes: z.number().int().min(16).max(512).default(120),
    }),
    func: async (
      { artifactRef, query, maxMatches, contextBytes },
      _runManager,
      config,
    ) =>
      invokeContextArtifactTool(
        execution,
        "context_search_artifact",
        toolInvocationId(config),
        async () => {
          const request = artifactSearchRequestSchema.parse({
            ...execution.metadataFor(`artifact-search:${artifactRef}`),
            projectId: execution.params.projectId,
            artifactId: artifactRef,
            query,
            maxMatches,
            contextBytes,
          });
          return artifactSearchResultSchema.parse(
            await execution.peer.call<unknown>(
              SIDECAR_METHODS.artifactSearch,
              request,
              execution.remainingMs(),
            ),
          );
        },
      ),
  });
  return [readArtifact, searchArtifact];
}

export async function invokeContextArtifactTool(
  execution: TurnExecution,
  toolName: "context_read_artifact" | "context_search_artifact",
  invocationId: string | undefined,
  invoke: () => Promise<unknown>,
) {
  execution.throwIfCancelled();
  const callId = `${toolName}:${invocationId ?? randomUUID()}`;
  const label =
    toolName === "context_read_artifact"
      ? "Read offloaded context"
      : "Search offloaded context";
  await execution.emit({
    type: "tool.started",
    callId,
    toolName,
    label,
  });
  try {
    const result = await execution.withReadOnlyLimit(invoke);
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName,
      label,
      success: true,
      detail:
        toolName === "context_read_artifact"
          ? "Read a bounded artifact range."
          : "Searched an encrypted artifact.",
    });
    return JSON.stringify(result);
  } catch (error) {
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName,
      label,
      success: false,
      detail: safeErrorMessage(error),
    });
    throw error;
  }
}
