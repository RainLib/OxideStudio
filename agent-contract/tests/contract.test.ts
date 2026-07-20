import { describe, expect, it } from "vitest";
import {
  AGENT_HOST_MAX_FRAME_BYTES,
  AGENT_HOST_PROTOCOL_VERSION,
  agentEventSchema,
  artifactReadRequestSchema,
  artifactSearchRequestSchema,
  graphCheckpointPutRequestSchema,
  initializeAgentHostParamsSchema,
  resumeInterruptSchema,
  startTurnParamsSchema,
} from "../src/index.js";

describe("agent host contract", () => {
  it("rejects incompatible protocol versions", () => {
    expect(() =>
      initializeAgentHostParamsSchema.parse({
        protocolVersion: 2,
        appVersion: "0.1.2",
        maxFrameBytes: AGENT_HOST_MAX_FRAME_BYTES,
        requiredCapabilities: [],
      }),
    ).toThrow();
  });

  it("requires scoped turn metadata", () => {
    expect(() =>
      startTurnParamsSchema.parse({
        requestId: "request",
        threadId: "thread",
        turnId: "turn",
        contextVersion: "context",
        deadline: Date.now() + 30_000,
        projectId: "project",
        profile: "chat",
        messages: [],
        prompt: "hello",
        provider: {
          model: "model",
          capabilities: {
            streaming: true,
            toolCalling: true,
            structuredOutput: true,
            maxInputTokens: 128_000,
            maxOutputTokens: 8_192,
          },
        },
        workspace: {
          projectId: "different-project",
          connectionId: null,
          database: null,
          namespace: null,
          activeTabId: null,
          configRevision: null,
          fingerprint: "fingerprint",
          summary: {},
        },
        tools: [],
      }),
    ).not.toThrow();
  });

  it("does not accept process details as final answers", () => {
    expect(() =>
      agentEventSchema.parse({
        type: "final.answer",
        threadId: "thread",
        turnId: "turn",
        sequence: 2,
        occurredAt: Date.now(),
        content: "done",
        artifacts: [],
      }),
    ).not.toThrow();
    expect(() =>
      agentEventSchema.parse({
        type: "final.answer",
        threadId: "thread",
        turnId: "turn",
        sequence: 2,
        occurredAt: Date.now(),
        content: 42,
      }),
    ).toThrow();
  });

  it("validates provider-reported model usage without message content", () => {
    expect(() =>
      agentEventSchema.parse({
        type: "model.usage",
        threadId: "thread",
        turnId: "turn",
        sequence: 3,
        occurredAt: Date.now(),
        calls: 2,
        inputTokens: 1_200,
        outputTokens: 300,
        totalTokens: 1_500,
      }),
    ).not.toThrow();
  });

  it("bounds artifact range reads and searches", () => {
    const metadata = {
      requestId: "request",
      threadId: "thread",
      turnId: "turn",
      contextVersion: "context",
      deadline: Date.now() + 30_000,
      projectId: "project",
      artifactId: "tool-result-1",
    };
    expect(
      artifactReadRequestSchema.parse({
        ...metadata,
        offset: 1024,
      }),
    ).toMatchObject({ maxBytes: 32 * 1024 });
    expect(() =>
      artifactReadRequestSchema.parse({
        ...metadata,
        maxBytes: 64 * 1024 + 1,
      }),
    ).toThrow();
    expect(
      artifactSearchRequestSchema.parse({
        ...metadata,
        query: "customer_id",
      }),
    ).toMatchObject({ maxMatches: 8, contextBytes: 120 });
  });

  it("validates opaque typed graph checkpoint blobs", () => {
    expect(() =>
      graphCheckpointPutRequestSchema.parse({
        requestId: "request",
        threadId: "thread",
        turnId: "turn",
        contextVersion: "context",
        deadline: Date.now() + 30_000,
        projectId: "project",
        checkpointThreadId: "oxide-checkpoint-thread",
        checkpointNs: "",
        checkpointId: "checkpoint-1",
        parentCheckpointId: null,
        checkpoint: { type: "json", data: "e30=" },
        metadata: { type: "json", data: "e30=" },
      }),
    ).not.toThrow();
  });

  it("keeps approval leases outside the persisted resume command", () => {
    expect(() =>
      resumeInterruptSchema.parse({
        kind: "approval",
        approvalId: "approval-1",
        decision: "approve",
        lease: "must-not-be-persisted",
      }),
    ).not.toThrow();
    expect(
      "lease" in
        resumeInterruptSchema.parse({
          kind: "approval",
          approvalId: "approval-1",
          decision: "approve",
          lease: "must-not-be-persisted",
        }),
    ).toBe(false);
  });

  expect(AGENT_HOST_PROTOCOL_VERSION).toBe(1);
});
