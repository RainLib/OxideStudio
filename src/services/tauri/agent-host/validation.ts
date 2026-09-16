import type { AgentCitation, AgentContextMetrics, AgentHostEvent } from "./contracts";

export function isAgentHostUnavailableError(error: unknown) {
  const text =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : JSON.stringify(error ?? "");
  return /(?:agent[_ -](?:host|start|resume|cancel|get|answer|approve)|command .* not found|unknown command|sidecar|not available|unavailable|failed to spawn)/iu.test(
    text,
  );
}

export function isAgentHostEvent(value: unknown): value is AgentHostEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const hasBase =
    typeof event.threadId === "string" &&
    typeof event.turnId === "string" &&
    typeof event.type === "string" &&
    typeof event.sequence === "number" &&
    typeof event.occurredAt === "number";
  if (
    !hasBase ||
    (event.projectMetrics !== undefined &&
      !isAgentContextMetrics(event.projectMetrics))
  ) {
    return false;
  }

  switch (event.type) {
    case "turn.status":
      return (
        typeof event.status === "string" &&
        [
          "starting",
          "planning",
          "running",
          "awaiting_input",
          "awaiting_approval",
          "completed",
          "failed",
          "cancelled",
        ].includes(event.status)
      );
    case "plan.changed":
      return (
        Array.isArray(event.items) &&
        event.items.every(
          (item) =>
            isRecord(item) &&
            typeof item.id === "string" &&
            typeof item.title === "string" &&
            typeof item.status === "string" &&
            ["pending", "running", "completed", "failed"].includes(
              item.status,
            ),
        )
      );
    case "tool.started":
    case "tool.finished":
      return (
        typeof event.callId === "string" &&
        typeof event.toolName === "string" &&
        typeof event.label === "string" &&
        (event.relativePath === undefined ||
          isSafeAgentRelativePath(event.relativePath))
      );
    case "file.changed":
      return (
        typeof event.callId === "string" &&
        isSafeAgentRelativePath(event.relativePath) &&
        (event.operation === "created" || event.operation === "updated") &&
        typeof event.revision === "string" &&
        /^[a-f0-9]{64}$/u.test(event.revision) &&
        (event.previousRevision === undefined ||
          event.previousRevision === null ||
          (typeof event.previousRevision === "string" &&
            /^[a-f0-9]{64}$/u.test(event.previousRevision))) &&
        (event.introducedLines === undefined ||
          (Array.isArray(event.introducedLines) &&
            event.introducedLines.length <= 2_048 &&
            event.introducedLines.every(
              (line, index, lines) =>
                Number.isInteger(line) &&
                line > 0 &&
                (index === 0 || line > lines[index - 1]!),
            ))) &&
        (event.lineEvidenceTruncated === undefined ||
          typeof event.lineEvidenceTruncated === "boolean") &&
        (event.originalContent === undefined ||
          (typeof event.originalContent === "string" &&
            event.originalContent.length <= 256 * 1024)) &&
        (event.appliedContent === undefined ||
          (typeof event.appliedContent === "string" &&
            event.appliedContent.length <= 256 * 1024)) &&
        (event.additions === undefined ||
          (typeof event.additions === "number" &&
            Number.isInteger(event.additions) &&
            event.additions >= 0)) &&
        (event.deletions === undefined ||
          (typeof event.deletions === "number" &&
            Number.isInteger(event.deletions) &&
            event.deletions >= 0)) &&
        (event.reviewable === undefined ||
          typeof event.reviewable === "boolean") &&
        (event.reviewable !== true ||
          (typeof event.originalContent === "string" &&
            typeof event.appliedContent === "string" &&
            typeof event.additions === "number" &&
            typeof event.deletions === "number"))
      );
    case "file.proposed":
      return (
        typeof event.callId === "string" &&
        isSafeAgentRelativePath(event.relativePath) &&
        (event.operation === "created" || event.operation === "updated") &&
        typeof event.proposedRevision === "string" &&
        /^[a-f0-9]{64}$/u.test(event.proposedRevision) &&
        (event.baseRevision === undefined ||
          event.baseRevision === null ||
          (typeof event.baseRevision === "string" &&
            /^[a-f0-9]{64}$/u.test(event.baseRevision))) &&
        typeof event.originalContent === "string" &&
        event.originalContent.length <= 256 * 1024 &&
        typeof event.proposedContent === "string" &&
        event.proposedContent.length <= 256 * 1024 &&
        typeof event.additions === "number" &&
        Number.isInteger(event.additions) &&
        event.additions >= 0 &&
        typeof event.deletions === "number" &&
        Number.isInteger(event.deletions) &&
        event.deletions >= 0
      );
    case "subagent":
      return (
        typeof event.name === "string" &&
        typeof event.status === "string" &&
        ["started", "completed", "failed"].includes(event.status)
      );
    case "clarification":
      return (
        typeof event.clarificationId === "string" &&
        Array.isArray(event.questions) &&
        event.questions.every(
          (question) =>
            isRecord(question) &&
            typeof question.id === "string" &&
            typeof question.prompt === "string" &&
            question.allowFreeText === true &&
            Array.isArray(question.options) &&
            question.options.every(
              (option) =>
                isRecord(option) &&
                typeof option.id === "string" &&
                typeof option.label === "string",
            ),
        )
      );
    case "approval":
      return (
        typeof event.approvalId === "string" &&
        typeof event.callId === "string" &&
        typeof event.inputDigest === "string" &&
        typeof event.toolName === "string" &&
        typeof event.title === "string" &&
        typeof event.summary === "string" &&
        typeof event.risk === "string" &&
        ["write", "destructive", "external"].includes(event.risk) &&
        (event.policyDigest === undefined ||
          typeof event.policyDigest === "string") &&
        (event.findings === undefined ||
          (Array.isArray(event.findings) &&
            event.findings.every(
              (finding) =>
                isRecord(finding) &&
                typeof finding.ruleId === "string" &&
                typeof finding.title === "string" &&
                typeof finding.detail === "string" &&
                ["allow", "confirm", "block"].includes(
                  String(finding.decision),
                ),
            ))) &&
        (event.confirmation === undefined ||
          (isRecord(event.confirmation) &&
            event.confirmation.kind === "phrase" &&
            typeof event.confirmation.phrase === "string" &&
            typeof event.confirmation.prompt === "string"))
      );
    case "context.compacted":
      return (
        typeof event.inputTokens === "number" &&
        typeof event.retainedTokens === "number" &&
        typeof event.offloadedArtifacts === "number"
      );
    case "model.usage":
      return (
        typeof event.calls === "number" &&
        event.calls > 0 &&
        typeof event.inputTokens === "number" &&
        typeof event.outputTokens === "number" &&
        typeof event.totalTokens === "number"
      );
    case "provider.activity":
      return (
        (event.provider === "codex-cli" ||
          event.provider === "codebuddy-cli") &&
        typeof event.status === "string" &&
        ["starting", "running", "completed", "error"].includes(
          event.status,
        ) &&
        typeof event.label === "string" &&
        (event.detail === undefined || typeof event.detail === "string")
      );
    case "answer.delta":
      return typeof event.content === "string" && typeof event.reset === "boolean";
    case "final.answer":
      return (
        typeof event.content === "string" &&
        Array.isArray(event.artifacts) &&
        event.artifacts.every((artifact) => typeof artifact === "string") &&
        (event.citations === undefined ||
          (Array.isArray(event.citations) &&
            event.citations.length <= 8 &&
            event.citations.every(isAgentCitation)))
      );
    case "failure":
      return (
        typeof event.code === "string" &&
        typeof event.message === "string" &&
        typeof event.retryable === "boolean"
      );
    default:
      return false;
  }
}

export function isAgentCitation(value: unknown): value is AgentCitation {
  if (!isRecord(value)) return false;
  const optionalStrings = [
    ["detail", 500],
    ["connectionId", 240],
    ["databaseName", 240],
    ["schemaName", 240],
    ["objectName", 240],
    ["objectType", 120],
    ["tabId", 240],
    ["planId", 240],
    ["nodeId", 240],
  ] as const;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 80 ||
    typeof value.label !== "string" ||
    !value.label ||
    value.label.length > 200 ||
    typeof value.toolName !== "string" ||
    !value.toolName ||
    value.toolName.length > 120 ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    value.projectId.length > 240 ||
    optionalStrings.some(
      ([key, max]) =>
        value[key] !== undefined &&
        (typeof value[key] !== "string" ||
          value[key].length === 0 ||
          value[key].length > max),
    )
  ) {
    return false;
  }
  if (value.kind === "databaseSchema") {
    return [value.connectionId, value.schemaName].every(
      (entry) => typeof entry === "string" && entry.length > 0,
    );
  }
  if (value.kind === "databaseObject") {
    return [value.connectionId, value.schemaName, value.objectName].every(
      (entry) => typeof entry === "string" && entry.length > 0,
    );
  }
  if (value.kind === "planNode") {
    return [value.tabId, value.planId, value.nodeId].every(
      (entry) => typeof entry === "string" && entry.length > 0,
    );
  }
  return false;
}

function isSafeAgentRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2_000) return false;
  if (value.includes("\0") || /^[\\/]/u.test(value) || /^[a-z]:/iu.test(value)) {
    return false;
  }
  return !value.split(/[\\/]/u).some((segment) => segment === "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentContextMetrics(value: unknown): value is AgentContextMetrics {
  if (!isRecord(value)) return false;
  const compaction = value.compaction;
  const modelUsage = value.modelUsage;
  return (
    typeof value.projectId === "string" &&
    typeof value.updatedAt === "number" &&
    (compaction === null ||
      (isRecord(compaction) &&
        typeof compaction.count === "number" &&
        typeof compaction.lastInputTokens === "number" &&
        typeof compaction.lastRetainedTokens === "number" &&
        typeof compaction.offloadedArtifacts === "number")) &&
    (modelUsage === null ||
      (isRecord(modelUsage) &&
        typeof modelUsage.calls === "number" &&
        typeof modelUsage.inputTokens === "number" &&
        typeof modelUsage.outputTokens === "number" &&
        typeof modelUsage.totalTokens === "number"))
  );
}
