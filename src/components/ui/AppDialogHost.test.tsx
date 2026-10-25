// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmAction, promptValue } from "@/lib/appDialogs";
import { AppDialogHost } from "./AppDialogHost";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("application dialog host", () => {
  let root: Root;
  beforeEach(async () => {
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root.render(<AppDialogHost/>));
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });
  it("focuses Cancel and resolves a rejected decision after closing", async () => {
    let result: boolean | undefined;
    await act(async () => { void confirmAction("Drop table?").then((value) => { result = value; }); });
    const cancel = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Cancel")!;
    expect(document.activeElement).toBe(cancel);
    expect(result).toBeUndefined();
    await act(async () => { cancel.click(); });
    await act(async () => { await vi.waitFor(() => expect(result).toBe(false)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("allows clearing a filter by submitting an empty prompt value", async () => {
    let result: string | null | undefined;
    await act(async () => { void promptValue("Filter", "").then((value) => { result = value; }); });
    expect(document.activeElement?.tagName).toBe("INPUT");
    await act(async () => { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await vi.waitFor(() => expect(result).toBe("")); });
  });
});
