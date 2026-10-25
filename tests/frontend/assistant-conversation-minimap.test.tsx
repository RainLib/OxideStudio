/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantConversationMinimap } from "@/components/workspace/assistant/AssistantConversationMinimap";
import { createAssistantTurn, type AssistantTurn } from "@/ai/assistant/turns";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const turns: AssistantTurn[] = Array.from({ length: 4 }, (_, index) => ({
  ...createAssistantTurn({
    id: `turn-${index + 1}`,
    requestId: `request-${index + 1}`,
    projectId: "project-1",
    requestedMode: "agent",
    mode: "agent",
    userMessage:
      index === 1 ? "Inspect the current database" : `Question ${index + 1}`,
    now: index,
  }),
  status: "completed" as const,
  process: [
    {
      id: `process-${index + 1}`,
      sequence: index,
      kind: "tool" as const,
      title: "Read schema metadata",
      status: "completed" as const,
      startedAt: index,
    },
  ],
  final: {
    content:
      index === 1
        ? "The users table has five columns."
        : `Answer ${index + 1}`,
    attachments: [],
    createdAt: index,
  },
}));

describe("AssistantConversationMinimap", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => { root?.unmount(); });
    root = null;
    host?.remove();
    host = null;
  });

  it("creates one gray anchor per turn and scrolls to its question and answer", async () => {
    const scrollContainer = document.createElement("div");
    Object.defineProperties(scrollContainer, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 200 },
    });
    scrollContainer.getBoundingClientRect = () => rect(0, 200);
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;
    turns.forEach((turn, index) => {
      const node = document.createElement("div");
      node.dataset.assistantTurnId = turn.id;
      node.getBoundingClientRect = () => rect(index * 240, 80);
      scrollContainer.appendChild(node);
    });
    document.body.appendChild(scrollContainer);

    host = document.createElement("div");
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(
        <AssistantConversationMinimap
          turns={turns}
          scrollContainerRef={{ current: scrollContainer }}
          contentVersion="v1"
        />,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const navigation = host.querySelector(
      'nav[aria-label="Conversation navigation"]',
    );
    expect(navigation).not.toBeNull();
    expect(navigation?.querySelectorAll("button")).toHaveLength(4);
    expect(
      navigation?.querySelector('button[aria-current="location"]')
        ?.getAttribute("aria-label"),
    ).toContain("Question 1");
    expect(navigation?.textContent).not.toContain("Read schema metadata");
    const inspectAnchor = navigation?.querySelector<HTMLButtonElement>('button[aria-label*="Inspect the current database"]');
    await act(async () => { inspectAnchor?.focus(); });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("The users table has five columns");

    await act(async () => {
      navigation
        ?.querySelector('button[aria-label*="Inspect the current database"]')
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
    });
    expect(scrollTo).toHaveBeenCalledWith({
      top: 208,
      behavior: "smooth",
    });

    scrollContainer.remove();
  });
});

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 500,
    bottom: top + height,
    width: 500,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}
