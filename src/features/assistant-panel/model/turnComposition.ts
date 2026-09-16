import { type PendingTextAttachment } from "@/features/assistant-panel/model/panelTypes";
import {
  type AgentProfile,
  type AgentToolManifestEntry,
} from "@/services/tauri/agent-host.service";

export function assistantToolManifestForProfile(
  profile: AgentProfile,
  tools: readonly AgentToolManifestEntry[],
) {
  if (profile === "chat") {
    return tools.filter((tool) => tool.name === "workspace.getActiveTab");
  }
  if (profile === "plan") {
    return tools.filter(
      (tool) =>
        tool.name !== "project.writeFile" &&
        tool.permissions.every((permission) => permission === "read"),
    );
  }
  return [...tools];
}

export function promptWithTextAttachments(
  message: string,
  attachments: readonly PendingTextAttachment[],
) {
  if (attachments.length === 0) return message;
  const blocks = attachments.map(
    (attachment) =>
      `\n\n--- Attached file: ${attachment.fileName} (${attachment.byteCount} bytes) ---\n${attachment.content}\n--- End attached file: ${attachment.fileName} ---`,
  );
  return `${message}${blocks.join("")}`;
}

export function createAgentTurnId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return `assistant-turn:${suffix}`;
}

export function agentTurnPendingLabel(status: string) {
  if (status === "planning") return "Planning...";
  if (status === "awaiting_input") return "Waiting for your answer";
  if (status === "awaiting_approval") return "Waiting for approval";
  if (status === "cancelling") return "Stopping...";
  return "Working...";
}
