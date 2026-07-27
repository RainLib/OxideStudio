import { describe, expect, it } from "vitest";
import {
  assistantConversationHistoryFromTurns,
  createAssistantTurn,
} from "@/ai/assistant/turns";
import { reduceAgentHostEvent } from "@/hooks/useAssistantAgentSession";
import type { AgentHostEvent } from "@/services/tauri/agent-host.service";

describe("assistant turn projection", () => {
  it("keeps process and tool activity out of conversation history", () => {
    const base = createAssistantTurn({
      id: "turn-1",
      requestId: "request-1",
      projectId: "project-1",
      requestedMode: "agent",
      mode: "agent",
      userMessage: "Inspect the users table",
      now: 10,
    });
    const turn = {
      ...base,
      process: [
        {
          id: "tool-1",
          sequence: 1,
          kind: "tool" as const,
          title: "metadata.listObjects",
          status: "completed" as const,
          startedAt: 11,
        },
      ],
      clarifications: [
        {
          clarificationId: "clarification-1",
          questionId: "schema",
          question: "Which schema should I inspect?",
          options: [],
          allowFreeText: true,
          answer: "public",
          answeredAt: 12,
        },
      ],
      final: {
        content: "The public.users table has five columns.",
        attachments: [],
        createdAt: 13,
      },
    };

    expect(assistantConversationHistoryFromTurns([turn])).toEqual([
      { role: "user", content: "Inspect the users table" },
      { role: "assistant", content: "Which schema should I inspect?" },
      { role: "user", content: "public" },
      {
        role: "assistant",
        content: "The public.users table has five columns.",
      },
    ]);
    expect(
      JSON.stringify(assistantConversationHistoryFromTurns([turn])),
    ).not.toContain("metadata.listObjects");
  });

  it("reduces clarification, compaction, process and final events into one turn", () => {
    let turn = createAssistantTurn({
      id: "turn-1",
      requestId: "request-1",
      projectId: "project-1",
      requestedMode: "o2",
      mode: "agent",
      userMessage: "Inspect this database",
      now: 10,
    });

    turn = reduceAgentHostEvent(
      turn,
      event("plan.changed", 1, {
        items: [
          {
            id: "step-1",
            title: "Read schema metadata",
            status: "running",
          },
        ],
      }),
    );
    turn = reduceAgentHostEvent(
      turn,
      event("context.compacted", 2, {
        inputTokens: 1_800,
        retainedTokens: 600,
        offloadedArtifacts: 2,
      }),
    );
    turn = reduceAgentHostEvent(
      turn,
      event("clarification", 3, {
        clarificationId: "clarify-1",
        context: "A data source is required before metadata can be read.",
        questions: [
          {
            id: "data-source",
            prompt: "Which saved data source should I use?",
            options: [
              { id: "warehouse", label: "Warehouse" },
              { id: "analytics", label: "Analytics" },
            ],
            allowFreeText: true,
          },
        ],
      }),
    );

    expect(turn.status).toBe("awaiting_input");
    expect(turn.process.map((item) => item.kind)).toEqual([
      "step",
      "compaction",
    ]);
    expect(turn.contextCompaction).toEqual({
      count: 1,
      lastInputTokens: 1_800,
      lastRetainedTokens: 600,
      offloadedArtifacts: 2,
    });
    turn = reduceAgentHostEvent(
      turn,
      event("model.usage", 4, {
        calls: 2,
        inputTokens: 1_200,
        outputTokens: 300,
        totalTokens: 1_500,
      }),
    );
    expect(turn.modelUsage).toEqual({
      calls: 2,
      inputTokens: 1_200,
      outputTokens: 300,
      totalTokens: 1_500,
    });
    expect(turn.clarifications[0]?.question).toContain("data source");

    turn = reduceAgentHostEvent(
      turn,
      event("answer.delta", 5, { content: "I found ", reset: true }),
    );
    turn = reduceAgentHostEvent(
      turn,
      event("answer.delta", 6, { content: "12 tables", reset: false }),
    );
    expect(turn.draft).toBe("I found 12 tables");

    turn = reduceAgentHostEvent(
      turn,
      event("answer.delta", 7, { content: "", reset: true }),
    );
    expect(turn.draft).toBe("");
    expect(turn.process.at(-1)).toEqual(
      expect.objectContaining({
        id: "commentary:7",
        kind: "commentary",
        title: "I found 12 tables",
        status: "completed",
      }),
    );

    turn = reduceAgentHostEvent(
      turn,
      event("final.answer", 8, {
        content: "I found 12 tables in Warehouse.",
        artifacts: [],
      }),
    );
    turn = reduceAgentHostEvent(
      turn,
      event("turn.status", 9, { status: "completed" }),
    );

    expect(turn.status).toBe("completed");
    expect(turn.draft).toBe("");
    expect(turn.final?.content).toBe("I found 12 tables in Warehouse.");
    expect(turn.process[0]).toEqual(
      expect.objectContaining({
        id: "plan:step-1",
        sequence: 1,
        startedAt: 1_001,
        status: "completed",
      }),
    );
  });

  it("preserves resumability when a retryable failure is followed by failed status", () => {
    let turn = createAssistantTurn({
      id: "turn-1",
      requestId: "request-1",
      projectId: "project-1",
      requestedMode: "agent",
      mode: "agent",
      userMessage: "Inspect this database",
      now: 10,
    });
    turn = reduceAgentHostEvent(
      turn,
      event("failure", 1, {
        code: "MODEL_TIMEOUT",
        message: "The model timed out.",
        retryable: true,
      }),
    );
    turn = reduceAgentHostEvent(
      turn,
      event("turn.status", 2, { status: "failed" }),
    );

    expect(turn.status).toBe("paused");
    expect(turn.error).toBe(
      "The request took too long. You can resume it without starting over.",
    );
    expect(turn.errorDetail).toBe("MODEL_TIMEOUT: The model timed out.");
  });

  it("adds a public fallback description before a tool when the model omitted one", () => {
    const base = createAssistantTurn({
      id: "turn-tool-description",
      requestId: "request-tool-description",
      projectId: "project-1",
      requestedMode: "agent",
      mode: "agent",
      userMessage: "Create a SQL file",
      now: 1_000,
    });

    const turn = reduceAgentHostEvent(
      base,
      event("tool.started", 1, {
        callId: "call-write",
        toolName: "project.writeFile",
        label: "Write project file",
        relativePath: "queries/report.sql",
      }),
    );

    expect(turn.process).toEqual([
      expect.objectContaining({
        id: "commentary:tool:call-write",
        kind: "commentary",
        title:
          "I’ll prepare the requested file change for review without writing it to disk.",
      }),
      expect.objectContaining({
        id: "tool:call-write",
        kind: "tool",
        title: "Write project file",
        relativePath: "queries/report.sql",
        status: "running",
      }),
    ]);
  });

  it("records trusted project writes once per tool call without entering chat history", () => {
    let turn = createAssistantTurn({
      id: "turn-1",
      requestId: "request-1",
      projectId: "project-1",
      requestedMode: "agent",
      mode: "agent",
      userMessage: "Update the report query",
      now: 10,
    });
    const change = {
      callId: "write-1",
      relativePath: "queries/report.sql",
      operation: "updated" as const,
      revision: "a".repeat(64),
      previousRevision: "b".repeat(64),
      introducedLines: [2, 5],
      lineEvidenceTruncated: false,
    };

    turn = reduceAgentHostEvent(turn, event("file.changed", 1, change));
    turn = reduceAgentHostEvent(turn, event("file.changed", 2, change));

    expect(turn.fileChanges).toEqual([
      expect.objectContaining({
        callId: "write-1",
        relativePath: "queries/report.sql",
        previousRevision: "b".repeat(64),
        introducedLines: [2, 5],
        occurredAt: 1_002,
      }),
    ]);
    expect(assistantConversationHistoryFromTurns([turn])).toEqual([]);
  });

  it("stores a file proposal as pending review without claiming a disk change", () => {
    let turn = createAssistantTurn({
      id: "turn-1",
      requestId: "request-1",
      projectId: "project-1",
      requestedMode: "agent",
      mode: "agent",
      userMessage: "Create a query",
      now: 10,
    });

    turn = reduceAgentHostEvent(
      turn,
      event("file.proposed", 1, {
        callId: "write-1",
        relativePath: "queries/pending.sql",
        operation: "created",
        proposedRevision: "a".repeat(64),
        baseRevision: null,
        originalContent: "",
        proposedContent: "select 1;\n",
        additions: 1,
        deletions: 0,
      }),
    );

    expect(turn.fileProposals).toEqual([
      expect.objectContaining({
        callId: "write-1",
        status: "pending",
        proposedContent: "select 1;\n",
      }),
    ]);
    expect(turn.fileChanges).toBeUndefined();
  });
});

function event<TType extends AgentHostEvent["type"]>(
  type: TType,
  sequence: number,
  fields: Omit<
    Extract<AgentHostEvent, { type: TType }>,
    "threadId" | "turnId" | "sequence" | "occurredAt" | "type"
  >,
) {
  return {
    threadId: "thread-1",
    turnId: "turn-1",
    sequence,
    occurredAt: 1_000 + sequence,
    type,
    ...fields,
  } as Extract<AgentHostEvent, { type: TType }>;
}
