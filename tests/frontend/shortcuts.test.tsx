/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcuts } from "@/hooks/useShortcuts";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { useSettingsStore } from "@/store/useSettingsStore";

const mocks = vi.hoisted(() => ({ runDatabaseExplorer: vi.fn() }));

vi.mock("@/lib/actions", () => ({
  findWorkbenchAction: (actionId: string) =>
    actionId === "workbench.toggleDatabaseExplorer"
      ? { run: mocks.runDatabaseExplorer }
      : undefined,
}));

function ShortcutHarness() {
  useShortcuts();
  return <textarea aria-label="SQL editor input" />;
}

describe("global workbench shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
    await act(async () => root.render(<ShortcutHarness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("toggles Database Explorer from the SQL editor with Command or Ctrl+1", async () => {
    const input = container.querySelector("textarea");
    expect(input).not.toBeNull();

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "1",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(mocks.runDatabaseExplorer).toHaveBeenCalledOnce(),
    );

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "1",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(mocks.runDatabaseExplorer).toHaveBeenCalledTimes(2));
  });
});
