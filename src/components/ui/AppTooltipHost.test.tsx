// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppTooltipHost } from "./AppTooltipHost";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("legacy title tooltips", () => {
  let root: Root;
  beforeEach(async () => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<><button title="Run query"/><AppTooltipHost/></>));
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });
  const trigger = () => document.querySelector("button")!;
  it("suppresses the native tooltip and keeps an icon button named", async () => {
    await act(async () => trigger().dispatchEvent(new PointerEvent("pointerover", { bubbles: true })));
    expect(trigger().hasAttribute("title")).toBe(false);
    expect(trigger().getAttribute("aria-label")).toBe("Run query");
    await act(async () => vi.advanceTimersByTime(350));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Run query");
    await act(async () => trigger().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    await act(async () => vi.advanceTimersByTime(80));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(trigger().getAttribute("title")).toBe("Run query");
  });
  it("cancels a delayed hover when the pointer leaves early", async () => {
    await act(async () => {
      trigger().dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      trigger().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));
      vi.advanceTimersByTime(500);
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
  it("supports keyboard hints and restores attributes when unmounted", async () => {
    await act(async () => { trigger().focus(); vi.advanceTimersByTime(1); });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Run query");
    const button = trigger();
    await act(async () => root.unmount());
    expect(button.getAttribute("title")).toBe("Run query");
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    root = createRoot(document.createElement("div"));
  });
});
