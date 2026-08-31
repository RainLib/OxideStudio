/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseExplorerHeader } from "@/components/workspace/DatabaseExplorerChrome";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("database explorer interaction feedback", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("replays locate feedback for every reveal action", async () => {
    const onRevealActive = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DatabaseExplorerHeader
          isLoading={false}
          onRevealActive={onRevealActive}
          onExpandActive={() => undefined}
          onCollapseAll={() => undefined}
          onRefresh={() => undefined}
          onHide={() => undefined}
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[title="Reveal Active Data Source"]',
    );
    expect(button).not.toBeNull();
    expect(container.querySelector(".wb-locate-feedback-pulse")).toBeNull();

    await act(async () => button?.click());
    const firstPulse = container.querySelector(".wb-locate-feedback-pulse");
    expect(firstPulse).not.toBeNull();

    await act(async () => button?.click());
    expect(onRevealActive).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".wb-locate-feedback-pulse")).not.toBe(firstPulse);
  });
});
