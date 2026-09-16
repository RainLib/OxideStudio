import { describe, expect, it } from "vitest";
import {
  assistantConversationBelongsToScope,
  assistantConversationContentVersion,
  assistantConversationHistoryVersion,
  assistantConversationId,
  assistantConversationScopeKey,
  assistantToolManifestForProfile,
  assistantTurnMetricsVersion,
  cliSetupForProviderIdentity,
  createAssistantConversationId,
} from "./harness";

describe("AssistantSidebar Agent Host path: identity", () => {
  it("isolates HTTP conversation history by non-secret destination", () => {
    const first = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://one.example.com/v1/",
      apiKey: "secret-one",
      model: "model-a",
    });
    const rotatedCredential = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://one.example.com/v1",
      apiKey: "secret-two",
      model: "model-b",
    });
    const otherDestination = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://two.example.com/v1",
      apiKey: "secret-one",
      model: "model-a",
    });
    const caseSensitivePath = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://one.example.com/V1",
      apiKey: "secret-one",
      model: "model-a",
    });
    const embeddedCredential = assistantConversationId({
      kind: "openai-compatible",
      baseUrl: "https://user:password@one.example.com/v1",
      apiKey: "secret-one",
      model: "model-a",
    });

    expect(first).toBe(rotatedCredential);
    expect(otherDestination).not.toBe(first);
    expect(caseSensitivePath).not.toBe(first);
    expect(embeddedCredential).toBe(first);
    expect(first).not.toContain("secret");
    expect(first).toMatch(/^provider:http:[0-9a-f]{32}$/u);
  });

  it("isolates CLI conversation history by non-secret provider profile", () => {
    const primary = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:primary",
      executablePath: "C:/tools/codex.cmd",
      model: "gpt-5.6-sol",
    });
    const sameProfileDifferentModel = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:primary",
      executablePath: "C:/tools/codex.cmd",
      model: "gpt-5.6-terra",
    });
    const anotherProfile = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:work",
      executablePath: "C:/tools/codex.cmd",
      model: "gpt-5.6-sol",
    });
    const anotherExecutable = assistantConversationId({
      kind: "codex-cli",
      profileId: "codex-cli:primary",
      executablePath: "D:/portable/codex.cmd",
      model: "gpt-5.6-sol",
    });
    const anotherProvider = assistantConversationId({
      kind: "codebuddy-cli",
      profileId: "codex-cli:primary",
      executablePath: "C:/tools/codex.cmd",
      model: "default",
    });

    expect(sameProfileDifferentModel).toBe(primary);
    expect(anotherProfile).not.toBe(primary);
    expect(anotherExecutable).not.toBe(primary);
    expect(anotherProvider).not.toBe(primary);
    expect(primary).toMatch(/^provider:cli:[0-9a-f]{32}$/u);
    expect(primary).not.toContain("primary");
    expect(primary).not.toContain("C:/tools");
  });

  it("creates bounded child conversation identities inside the provider scope", () => {
    const scope = "provider:http:0123456789abcdef0123456789abcdef";
    const conversationId = createAssistantConversationId(
      scope,
      1_700_000_000_000,
      "A1B2-C3D4-extra",
    );

    expect(conversationId).toBe(`${scope}:chat:loyw3v28-a1b2-c3d`);
    expect(conversationId.length).toBeLessThanOrEqual(80);
    expect(assistantConversationBelongsToScope(conversationId, scope)).toBe(
      true,
    );
    expect(
      assistantConversationBelongsToScope(
        "provider:http:other:chat:one",
        scope,
      ),
    ).toBe(false);
  });

  it("does not reuse a ready CLI setup after its identity changes", () => {
    const ready = {
      phase: "ready" as const,
      message: "CLI is installed and authenticated",
      executablePath: "C:/tools/codex.cmd",
    };

    expect(
      cliSetupForProviderIdentity(
        ready,
        "identity:old",
        "identity:old",
        "Checking",
      ),
    ).toBe(ready);
    expect(
      cliSetupForProviderIdentity(
        ready,
        "identity:new",
        "identity:old",
        "Checking",
      ),
    ).toEqual({
      ...ready,
      phase: "checking",
      message: "Checking",
      refreshing: true,
    });
  });

  it("keeps streaming content versions constant-time around the hot turn", () => {
    const turns = Array.from({ length: 80 }, (_, index) => ({
      id: `turn-${index}`,
      updatedAt: index,
      status: "completed" as const,
      process: [],
      draft: "",
      final: { content: `answer ${index}`, attachments: [], createdAt: index },
    })) as any[];
    const active = {
      ...turns[12],
      status: "running" as const,
      draft: "streaming",
      updatedAt: 100,
      final: null,
    };
    const before = assistantConversationContentVersion(turns, active);
    const after = assistantConversationContentVersion(turns, {
      ...active,
      draft: "streaming more",
      updatedAt: 101,
    });

    expect(before).not.toBe(after);
    expect(after).toContain("turn-12:101:running:0:14:0");
    expect(after).toContain("turn-79:79:completed:0:0:9");
  });

  it("does not rebuild future history or metric aggregates for draft-only deltas", () => {
    const turns = Array.from({ length: 80 }, (_, index) => ({
      id: `turn-${index}`,
      updatedAt: index,
      status: "completed" as const,
      process: [],
      draft: "",
      final: { content: `answer ${index}`, attachments: [], createdAt: index },
      clarifications: [],
      contextCompaction: null,
      modelUsage: null,
    })) as any[];
    const active = {
      ...turns[12],
      status: "running" as const,
      draft: "streaming",
      updatedAt: 100,
      final: null,
    };
    const draftDelta = { ...active, draft: "streaming more", updatedAt: 101 };

    expect(assistantConversationHistoryVersion(turns, active)).toBe(
      assistantConversationHistoryVersion(turns, draftDelta),
    );
    expect(assistantTurnMetricsVersion(turns, active)).toBe(
      assistantTurnMetricsVersion(turns, draftDelta),
    );
    expect(
      assistantConversationHistoryVersion(turns, {
        ...draftDelta,
        final: { content: "complete", attachments: [], createdAt: 102 },
      }),
    ).not.toBe(assistantConversationHistoryVersion(turns, active));
  });

  it("filters tools by Chat, Plan, and Agent authority", () => {
    const tools = [
      {
        name: "workspace.getActiveTab",
        description: "Read active tab",
        inputSchema: { type: "object" },
        permissions: ["read" as const],
      },
      {
        name: "query.runReadOnly",
        description: "Run read-only query",
        inputSchema: { type: "object" },
        permissions: ["read" as const],
      },
      {
        name: "project.writeFile",
        description: "Write file",
        inputSchema: { type: "object" },
        permissions: ["write" as const],
      },
    ];

    expect(
      assistantToolManifestForProfile("chat", tools).map((tool) => tool.name),
    ).toEqual(["workspace.getActiveTab"]);
    expect(
      assistantToolManifestForProfile("plan", tools).map((tool) => tool.name),
    ).toEqual(["workspace.getActiveTab", "query.runReadOnly"]);
    expect(
      assistantToolManifestForProfile("agent", tools).map((tool) => tool.name),
    ).toEqual([
      "workspace.getActiveTab",
      "query.runReadOnly",
      "project.writeFile",
    ]);
  });
});
