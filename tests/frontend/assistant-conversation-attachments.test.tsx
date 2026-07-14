/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantConversation } from "@/components/workspace/assistant/AssistantConversation";
import type { AssistantAttachment } from "@/ai/ui-actions/types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AssistantConversation attachments", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("executes primary and secondary typed actions from an object reference", async () => {
    const attachment: AssistantAttachment = {
      id: "users-object",
      kind: "databaseObject",
      label: "users",
      detail: "app_db.public.users",
      action: {
        id: "reveal-users",
        action: "database.revealObject",
        target: {
          projectId: "project-1",
          connectionId: "connection-1",
          databaseName: "app_db",
          schemaName: "public",
          objectName: "users",
        },
        issuedAgainst: { projectId: "project-1", contextVersion: 1 },
        presentation: { label: "Reveal users" },
      },
      secondaryActions: [
        {
          id: "open-users-data",
          action: "database.openObjectData",
          target: {
            projectId: "project-1",
            connectionId: "connection-1",
            databaseName: "app_db",
            schemaName: "public",
            objectName: "users",
          },
          issuedAgainst: { projectId: "project-1", contextVersion: 1 },
          presentation: { label: "Open data" },
        },
      ],
    };
    const onExecuteAttachment = vi.fn(async (request) => ({
      actionId: request.id,
      status: "success" as const,
      code: "OK" as const,
    }));

    await act(async () => {
      root.render(
        <AssistantConversation
          entries={[
            {
              id: "message-1",
              role: "assistant",
              content: "I found the table.",
              attachments: [attachment],
            },
          ]}
          isResponding={false}
          pendingLabel="Thinking"
          onUsePrompt={vi.fn()}
          onExecuteAttachment={onExecuteAttachment}
        />
      );
    });

    const revealButton = container.querySelector<HTMLButtonElement>(
      'button[title="Reveal users"]'
    );
    expect(revealButton?.textContent).toContain("users");
    await act(async () => revealButton?.click());
    expect(onExecuteAttachment).toHaveBeenLastCalledWith(attachment.action);

    const openDataButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button")
    ).find((button) => button.textContent === "Open data");
    await act(async () => openDataButton?.click());
    expect(onExecuteAttachment).toHaveBeenLastCalledWith(
      attachment.secondaryActions?.[0]
    );
  });
});
