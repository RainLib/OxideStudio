/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readArtifact: vi.fn(),
  searchArtifact: vi.fn(),
  exportArtifact: vi.fn(),
}));

vi.mock("@/services/tauri/agent-host.service", () => ({
  agentHostService: {
    readArtifact: mocks.readArtifact,
    searchArtifact: mocks.searchArtifact,
    exportArtifact: mocks.exportArtifact,
  },
}));

import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import { createAssistantTurn } from "@/ai/assistant/turns";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Assistant artifact results", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readArtifact.mockResolvedValue({
      artifactId: "tool-result-large",
      found: true,
      offset: 0,
      nextOffset: 30,
      totalBytes: 30,
      eof: true,
      content: '{\n  "name": "events-2026"\n}',
    });
    mocks.searchArtifact.mockResolvedValue({
      artifactId: "tool-result-large",
      query: "events",
      found: true,
      totalBytes: 30,
      matchCount: 1,
      truncated: false,
      matches: [
        {
          offset: 13,
          length: 6,
          snippetOffset: 0,
          snippet: '"name": "events-2026"',
        },
      ],
    });
    mocks.exportArtifact.mockResolvedValue({
      artifactId: "tool-result-large",
      exported: true,
      filePath: "/tmp/result.json",
      byteCount: 31,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("previews, searches and explicitly exports a final artifact", async () => {
    const turn = {
      ...createAssistantTurn({
        id: "turn-1",
        requestId: "request-1",
        projectId: "project-1",
        requestedMode: "agent",
        mode: "agent",
        userMessage: "Inspect all events",
        now: 1,
      }),
      status: "completed" as const,
      final: {
        content: "The complete result was retained locally.",
        attachments: [],
        artifactRefs: ["tool-result-large", "tool-result-large"],
        createdAt: 2,
      },
    };
    await act(async () => {
      root.render(
        <AssistantConversation
          turns={[turn]}
          isResponding={false}
          pendingLabel="Thinking"
          onUsePrompt={vi.fn()}
          onExecuteAttachment={vi.fn()}
        />,
      );
    });

    expect(container.querySelectorAll("details")).toHaveLength(1);
    const details = container.querySelector("details")!;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    expect(mocks.readArtifact).toHaveBeenCalledWith({
      projectId: "project-1",
      artifactId: "tool-result-large",
      offset: 0,
      maxBytes: 16_384,
    });
    expect(container.textContent).toContain("events-2026");

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Find in result"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(input, "events");
      input.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: "events" }),
      );
      await Promise.resolve();
    });
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(mocks.searchArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ query: "events" }),
    );
    expect(container.textContent).toContain("events-2026");

    const exportButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Export JSON"))!;
    await act(async () => exportButton.click());
    expect(mocks.exportArtifact).toHaveBeenCalledWith({
      projectId: "project-1",
      artifactId: "tool-result-large",
      suggestedFileName: "oxide-agent-result-1.json",
    });
    expect(container.textContent).toContain("Exported 31 B");
  });
});
