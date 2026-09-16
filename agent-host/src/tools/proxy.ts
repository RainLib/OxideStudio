import { DynamicStructuredTool } from "@langchain/core/tools";
import { interrupt } from "@langchain/langgraph";
import {
  SIDECAR_METHODS,
  boundedObservationSchema,
  commandPreflightResultSchema,
  type AgentToolManifestEntry,
  type ToolInvokeRequest,
  type ToolPreflightRequest,
} from "@oxide/agent-contract";
import type { TurnExecution } from "../runtime/execution.js";
import {
  approvalResolution,
  approvalRisk,
  approvalSummary,
  isToolAllowedForProfile,
  processLabel,
  projectToolRelativePath,
  toolRequiresApproval,
} from "./approvals.js";
import { citationCandidatesFromObservation } from "./citations.js";
import { askUser } from "./clarification.js";
import {
  connectionSelection,
  selectedConnectionFromResolution,
} from "./connections.js";
import {
  canonicalInputDigest,
  stableApprovalId,
  stableToolCallId,
  toolInvocationId,
} from "./identity.js";
import {
  safeErrorMessage,
  serializeObservation,
  toolObservationDetail,
} from "./observations.js";
import { isRecord } from "./value.js";

export function createProxyTools(execution: TurnExecution) {
  return execution.params.tools
    .filter((manifest) =>
      isToolAllowedForProfile(manifest, execution.params.profile),
    )
    .map(
      (manifest) =>
        new DynamicStructuredTool({
          name: manifest.name,
          description: manifest.description,
          schema: manifest.inputSchema,
          func: async (input, _runManager, config) =>
            invokeProxyTool(
              execution,
              manifest,
              input,
              toolInvocationId(config),
            ),
        }),
    );
}

export async function invokeProxyTool(
  execution: TurnExecution,
  manifest: AgentToolManifestEntry,
  input: unknown,
  invocationId?: string,
): Promise<string> {
  execution.throwIfCancelled();
  const inputDigest = canonicalInputDigest(input);
  const callId = stableToolCallId(
    execution,
    manifest.name,
    inputDigest,
    invocationId,
  );
  const label = processLabel(manifest.name);
  const relativePath = projectToolRelativePath(manifest.name, input);
  await execution.emit({
    type: "tool.started",
    callId,
    toolName: manifest.name,
    label,
    ...(relativePath ? { relativePath } : {}),
  });

  let approvalLease: string | undefined;
  let policyDigest: string | undefined;
  let commandPreflight:
    | ReturnType<typeof commandPreflightResultSchema.parse>
    | undefined;
  const mutation = manifest.permissions.some(
    (permission) => permission !== "read",
  );
  if (manifest.name === "shell.execute") {
    const preflightRequest: ToolPreflightRequest = {
      ...execution.metadataFor(`tool:${callId}:preflight`),
      callId,
      toolName: manifest.name,
      input,
      inputDigest,
    };
    const raw = await execution.withReadOnlyLimit(() =>
      execution.peer.call<unknown>(
        SIDECAR_METHODS.toolPreflight,
        preflightRequest,
        execution.remainingMs(),
      ),
    );
    commandPreflight = commandPreflightResultSchema.parse(raw);
    policyDigest = commandPreflight.policyDigest;
    if (commandPreflight.decision === "block") {
      const detail =
        commandPreflight.findings[0]?.detail ??
        "OxideStudio command policy blocked this shell command.";
      await execution.emit({
        type: "tool.finished",
        callId,
        toolName: manifest.name,
        label,
        success: false,
        detail,
      });
      throw new Error(`Command blocked: ${detail}`);
    }
  }
  if (toolRequiresApproval(manifest)) {
    const approvalResume = execution.matchingResume("approval");
    const approvalId = approvalResume
      ? approvalResume.approvalId
      : stableApprovalId(callId);
    const payload = {
      kind: "approval" as const,
      approvalId,
      decision: "reject" as const,
    };
    execution.markSuspended(
      payload,
      approvalResume
        ? null
        : {
            type: "approval",
            approvalId,
            callId,
            inputDigest,
            toolName: manifest.name,
            title: `Approve ${manifest.name}`,
            risk: approvalRisk(manifest),
            summary:
              commandPreflight?.summary ??
              approvalSummary(manifest.name, input),
            ...(policyDigest ? { policyDigest } : {}),
            ...(commandPreflight?.findings.length
              ? { findings: commandPreflight.findings }
              : {}),
            ...(commandPreflight?.confirmation
              ? { confirmation: commandPreflight.confirmation }
              : {}),
          },
    );
    const resumed = interrupt(payload);
    execution.clearSuspension();
    execution.markResumeConsumed();
    const decision = approvalResolution(resumed, approvalId);
    if (decision !== "approve") {
      await execution.emit({
        type: "tool.finished",
        callId,
        toolName: manifest.name,
        label,
        ...(relativePath ? { relativePath } : {}),
        success: false,
        detail: "User rejected the action.",
      });
      throw new Error(`Action rejected: ${manifest.name}`);
    }
    approvalLease = execution.consumeApprovalLease(approvalId) ?? undefined;
    if (!approvalLease) {
      throw new Error(
        `Approval lease is unavailable after resume; ${manifest.name} was not executed.`,
      );
    }
  }

  const request: ToolInvokeRequest = {
    ...execution.metadataFor(`tool:${callId}`),
    callId,
    toolName: manifest.name,
    input,
    inputDigest,
    approvalLease,
    policyDigest,
  };
  try {
    const invoke = () =>
      execution.peer.call<unknown>(
        SIDECAR_METHODS.toolInvoke,
        request,
        execution.remainingMs(),
      );
    const raw = mutation
      ? await execution.withMutationLock(invoke)
      : await execution.withReadOnlyLimit(invoke);
    const observation = boundedObservationSchema.parse(raw);
    const citations = citationCandidatesFromObservation(
      manifest.name,
      input,
      observation,
      execution.params.workspace,
    );
    execution.recordCitations(citations);
    execution.recordArtifactReference(observation.artifactRef);
    await execution.emit({
      type: "tool.finished",
      callId,
      toolName: manifest.name,
      label,
      ...(relativePath ? { relativePath } : {}),
      success: true,
      detail: toolObservationDetail(observation),
    });
    return serializeObservation(observation, citations);
  } catch (error) {
    const selection = connectionSelection(error);
    if (
      selection &&
      manifest.permissions.every((permission) => permission === "read")
    ) {
      const resolution = await askUser(
        execution,
        [
          {
            id: "connectionId",
            prompt: "Which database connection should I use?",
            options: selection.candidates.slice(0, 3).map((candidate) => ({
              id: candidate.id,
              label: candidate.name,
              description: candidate.driver,
            })),
            allowFreeText: true,
          },
        ],
        `${invocationId ?? callId}:connection-selection`,
      );
      const selectedConnectionId = selectedConnectionFromResolution(
        resolution,
        selection.candidates,
      );
      const resolvedInput = {
        ...(isRecord(input) ? input : {}),
        connectionId: selectedConnectionId,
      };
      const resolvedDigest = canonicalInputDigest(resolvedInput);
      const resolvedRequest: ToolInvokeRequest = {
        ...execution.metadataFor(`tool:${callId}:connection`),
        callId,
        toolName: manifest.name,
        input: resolvedInput,
        inputDigest: resolvedDigest,
      };
      const raw = await execution.withReadOnlyLimit(() =>
        execution.peer.call<unknown>(
          SIDECAR_METHODS.toolInvoke,
          resolvedRequest,
          execution.remainingMs(),
        ),
      );
      const observation = boundedObservationSchema.parse(raw);
      const citations = citationCandidatesFromObservation(
        manifest.name,
        resolvedInput,
        observation,
        execution.params.workspace,
      );
      execution.recordCitations(citations);
      execution.recordArtifactReference(observation.artifactRef);
      await execution.emit({
        type: "tool.finished",
        callId,
        toolName: manifest.name,
        label,
        ...(relativePath ? { relativePath } : {}),
        success: true,
        detail: toolObservationDetail(observation),
      });
      return serializeObservation(observation, citations);
    }

    await execution.emit({
      type: "tool.finished",
      callId,
      toolName: manifest.name,
      label,
      ...(relativePath ? { relativePath } : {}),
      success: false,
      detail: safeErrorMessage(error),
    });
    throw error;
  }
}
