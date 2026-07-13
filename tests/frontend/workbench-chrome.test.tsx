/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkbenchGlobalTools,
  WorkbenchStatusBar,
  WorkbenchTitleTools,
} from "@/components/workspace/WorkbenchChrome";
import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actions";
import { useProjectStore } from "@/store/useProjectStore";
import { useTaskStore } from "@/store/useTaskStore";

describe("WorkbenchChrome", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    useProjectStore.setState({ activeProjectName: "sqls" });
    useTaskStore.setState({ tasks: [] });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("shows project context until an editor tab is active", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchStatusBar
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("sqls");
    expect(container.textContent).not.toContain("Database");

    await act(async () => {
      root?.render(
        <WorkbenchStatusBar
          activeConnectionName="Local Postgres"
          currentSchema="public"
          activeTabTitle="Query #1"
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain("Database");
    expect(container.textContent).toContain("Local Postgres");
    expect(container.textContent).toContain("public");
    expect(container.textContent).toContain("Query #1");
  });

  it("keeps title tool buttons wired to their tool windows", async () => {
    const onToggleDatabaseExplorer = vi.fn();
    const onToggleAssistant = vi.fn();
    const onToggleFiles = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchTitleTools
          databaseExplorerOpen
          databaseExplorerSide="left"
          secondaryPanelOpen={false}
          secondaryPanelView="assistant"
          assistantSide="right"
          onToggleDatabaseExplorer={onToggleDatabaseExplorer}
          onToggleAssistant={onToggleAssistant}
          onToggleFiles={onToggleFiles}
        />
      );
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[2]?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      buttons[0]?.click();
      buttons[1]?.click();
      buttons[2]?.click();
    });

    expect(onToggleDatabaseExplorer).toHaveBeenCalledOnce();
    expect(onToggleAssistant).toHaveBeenCalledOnce();
    expect(onToggleFiles).toHaveBeenCalledOnce();
  });

  it("opens the command palette from the global search control", async () => {
    const listener = vi.fn();
    window.addEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, listener);

    await act(async () => {
      root = createRoot(container);
      root.render(<WorkbenchGlobalTools />);
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, listener);
  });
});
