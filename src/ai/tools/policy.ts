import type {
  AiToolDefinition,
  AiToolExecutionPolicy,
  AiToolPermission,
  AiToolPolicyDecision,
  AiToolSummary,
} from "./types";

export const DEFAULT_AI_TOOL_POLICY: AiToolExecutionPolicy = {
  allowPermissions: ["read"],
  requireApprovalFor: ["write", "destructive", "external"],
};

export function evaluateAiToolPolicy(
  tool: AiToolDefinition | AiToolSummary,
  policy: AiToolExecutionPolicy = DEFAULT_AI_TOOL_POLICY
): AiToolPolicyDecision {
  const allowPermissions = new Set(
    policy.allowPermissions ?? DEFAULT_AI_TOOL_POLICY.allowPermissions
  );
  const approvalPermissions = new Set(
    policy.requireApprovalFor ?? DEFAULT_AI_TOOL_POLICY.requireApprovalFor
  );
  const approvedTools = new Set(policy.approvedTools ?? []);
  const deniedTools = new Set(policy.deniedTools ?? []);

  if (deniedTools.has(tool.name)) {
    return deny(tool, false, "Tool is denied by policy");
  }

  if (tool.permissions.length === 0) {
    return deny(tool, false, "Tool does not declare permissions");
  }

  const requiresApproval = tool.permissions.some((permission) =>
    approvalPermissions.has(permission)
  );
  if (requiresApproval && !approvedTools.has(tool.name)) {
    return deny(tool, true, "Tool requires explicit approval");
  }

  const unsupportedPermission = tool.permissions.find(
    (permission) =>
      !allowPermissions.has(permission) && !approvalPermissions.has(permission)
  );
  if (unsupportedPermission) {
    return deny(
      tool,
      false,
      `Permission is not allowed by policy: ${unsupportedPermission}`
    );
  }

  return {
    toolName: tool.name,
    allowed: true,
    requiresApproval: false,
    permissions: [...tool.permissions],
  };
}

export function approveAiToolForPolicy(
  policy: AiToolExecutionPolicy,
  toolName: string
): AiToolExecutionPolicy {
  return {
    ...policy,
    approvedTools: Array.from(new Set([...(policy.approvedTools ?? []), toolName])),
  };
}

function deny(
  tool: AiToolDefinition | AiToolSummary,
  requiresApproval: boolean,
  reason: string
): AiToolPolicyDecision {
  return {
    toolName: tool.name,
    allowed: false,
    requiresApproval,
    reason,
    permissions: [...tool.permissions] as AiToolPermission[],
  };
}
