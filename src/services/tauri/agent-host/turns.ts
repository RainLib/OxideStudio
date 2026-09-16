import { invokeRawCommand } from "../client";
import type {
  AgentActionAccepted,
  AgentAnswerClarificationRequest,
  AgentApproveActionRequest,
  AgentCancelTurnRequest,
  AgentStartTurnRequest,
  AgentTurnAccepted,
  AgentTurnJournal,
  AgentTurnRuntimeStatus,
} from "./contracts";

export async function startAgentTurn(
  request: AgentStartTurnRequest,
): Promise<AgentTurnAccepted> {
  return await invokeRawCommand<AgentTurnAccepted>("agent_start_turn", { request });
}

export async function resumeAgentTurn(
  request: AgentStartTurnRequest,
): Promise<AgentTurnAccepted> {
  return await invokeRawCommand<AgentTurnAccepted>("agent_resume_turn", { request });
}

export async function cancelAgentTurn(
  request: AgentCancelTurnRequest,
): Promise<AgentActionAccepted> {
  return await invokeRawCommand<AgentActionAccepted>("agent_cancel_turn", { request });
}

export async function getAgentTurnRuntimeStatus(
  request: AgentCancelTurnRequest,
): Promise<AgentTurnRuntimeStatus> {
  return await invokeRawCommand<AgentTurnRuntimeStatus>(
    "agent_turn_runtime_status",
    { request },
  );
}

export async function loadAgentTurnJournal(
  projectId: string,
  threadId: string,
  turnId: string,
): Promise<AgentTurnJournal | null> {
  return await invokeRawCommand<AgentTurnJournal | null>(
    "agent_load_turn_journal",
    { projectId, threadId, turnId },
  );
}

export async function answerAgentClarification(
  request: AgentAnswerClarificationRequest,
): Promise<AgentActionAccepted> {
  return await invokeRawCommand<AgentActionAccepted>(
    "agent_answer_clarification",
    { request },
  );
}

export async function approveAgentAction(
  request: AgentApproveActionRequest,
): Promise<AgentActionAccepted> {
  return await invokeRawCommand<AgentActionAccepted>("agent_approve_action", {
    request,
  });
}
