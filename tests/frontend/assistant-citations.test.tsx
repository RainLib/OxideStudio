/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/ai/ui-actions/context", () => ({
  captureWorkspaceUiActionContext: () => ({
    projectId: "project-1",
    contextVersion: 12,
  }),
}));

import { AssistantCitationList } from "@/components/workspace/assistant/AssistantCitationList";
import type { AgentCitation } from "@/services/tauri/agent-host.service";

const citations: AgentCitation[] = [
  {
    id: "cite-schema-public",
    kind: "databaseSchema",
    label: "public",
    detail: "app.public",
    toolName: "metadata.listObjects",
    projectId: "project-1",
    connectionId: "postgres-1",
    databaseName: "app",
    schemaName: "public",
  },
  {
    id: "cite-object-users",
    kind: "databaseObject",
    label: "users",
    detail: "app.public.users",
    toolName: "metadata.describeObject",
    projectId: "project-1",
    connectionId: "postgres-1",
    databaseName: "app",
    schemaName: "public",
    objectName: "users",
    objectType: "table",
  },
  {
    id: "cite-plan-root",
    kind: "planNode",
    label: "Explain Plan · Index Scan",
    detail: "postgres · estimate",
    toolName: "query.explain",
    projectId: "project-1",
    tabId: "query-1",
    planId: "plan-1",
    nodeId: "plan-1:root",
  },
];

describe("AssistantCitationList", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("renders numbered trusted sources and opens their stable targets", async () => {
    const onExecute = vi.fn(async (request) => ({
      actionId: request.id,
      status: "success" as const,
      code: "OK" as const,
    }));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <AssistantCitationList
          citations={citations}
          onExecute={onExecute}
        />,
      );
    });

    expect(container.textContent).toContain("Sources");
    expect(container.textContent).toContain("3 verified");
    expect(container.textContent).toContain("app.public.users");
    expect(container.textContent).toContain("Explain Plan · Index Scan");

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-assistant-citation-id="cite-schema-public"] button',
        )
        ?.click();
    });
    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "database.revealSchema",
        target: {
          projectId: "project-1",
          connectionId: "postgres-1",
          databaseName: "app",
          schemaName: "public",
        },
      }),
    );

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>(
          '[data-assistant-citation-id="cite-plan-root"] button',
        )
        ?.click();
    });

    expect(onExecute).toHaveBeenCalledWith({
      id: "cite-plan-root:reveal",
      action: "plan.revealNode",
      target: {
        projectId: "project-1",
        tabId: "query-1",
        planId: "plan-1",
        nodeId: "plan-1:root",
      },
      issuedAgainst: { projectId: "project-1", contextVersion: 12 },
      presentation: {
        label: "Open source Explain Plan · Index Scan",
        reveal: true,
        focus: true,
      },
    });
  });
});
