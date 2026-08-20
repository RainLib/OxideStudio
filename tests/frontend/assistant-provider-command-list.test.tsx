/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantProviderCommandList } from "@/components/workspace/assistant/AssistantProviderCommandList";

describe("AssistantProviderCommandList", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  let clientWidthDescriptor: PropertyDescriptor | undefined;
  let scrollWidthDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    scrollWidthDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollWidth",
    );
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    if (clientWidthDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        clientWidthDescriptor,
      );
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
    if (scrollWidthDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollWidth",
        scrollWidthDescriptor,
      );
    } else {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
    vi.useRealTimers();
  });

  function mockCommandMeasurements(overflowing: boolean) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).hasAttribute(
          "data-assistant-command-description",
        )
          ? 120
          : 80;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        if (
          (this as HTMLElement).hasAttribute(
            "data-assistant-command-description",
          )
        ) {
          return overflowing ? 360 : 120;
        }
        return 80;
      },
    });
  }

  async function renderCommandList() {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <AssistantProviderCommandList
          commands={[
            {
              name: "code-review",
              description:
                "Review the current diff for correctness bugs and quality cleanup opportunities",
              argumentHint: "optional review focus",
            },
          ]}
          activeIndex={0}
          onActiveIndexChange={() => undefined}
          onAccept={() => undefined}
        />,
      );
      await Promise.resolve();
    });
  }

  it("keeps each command on one line and shows its full text on hover only when truncated", async () => {
    vi.useFakeTimers();
    mockCommandMeasurements(true);
    await renderCommandList();

    const option = container.querySelector<HTMLButtonElement>(
      '[data-assistant-command-option="code-review"]',
    )!;
    const description = option.querySelector<HTMLElement>(
      "[data-assistant-command-description]",
    )!;
    expect(option.className).toContain("items-center");
    expect(option.className).toContain("overflow-hidden");
    expect(description.className).toContain("truncate");
    expect(description.className).toContain("whitespace-nowrap");
    expect(option.dataset.assistantCommandOverflow).toBe("true");

    await act(async () => {
      option.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
        }),
      );
      await vi.advanceTimersByTimeAsync(260);
    });

    const tooltip = document.body.querySelector<HTMLElement>("[role=tooltip]");
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain("/code-review");
    expect(tooltip?.textContent).toContain(
      "Review the current diff for correctness bugs and quality cleanup opportunities",
    );
    expect(tooltip?.textContent).toContain("optional review focus");
  });

  it("does not create a tooltip for content that fits", async () => {
    mockCommandMeasurements(false);
    await renderCommandList();

    const option = container.querySelector<HTMLButtonElement>(
      '[data-assistant-command-option="code-review"]',
    )!;
    expect(option.dataset.assistantCommandOverflow).toBe("false");

    await act(async () => {
      option.focus();
      await Promise.resolve();
    });
    expect(document.body.querySelector("[role=tooltip]")).toBeNull();
  });

  it("exposes the complete truncated command to keyboard focus", async () => {
    mockCommandMeasurements(true);
    await renderCommandList();

    const option = container.querySelector<HTMLButtonElement>(
      '[data-assistant-command-option="code-review"]',
    )!;
    await act(async () => {
      option.focus();
      await Promise.resolve();
    });

    expect(document.body.querySelector("[role=tooltip]")?.textContent).toContain(
      "optional review focus",
    );
  });
});
