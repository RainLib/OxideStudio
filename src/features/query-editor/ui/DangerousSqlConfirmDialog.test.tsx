// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DangerousSqlConfirmDialog } from "./DangerousSqlConfirmDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("DangerousSqlConfirmDialog", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  async function render(onDecision = vi.fn()) {
    await act(async () => {
      root.render(
        <DangerousSqlConfirmDialog
          open
          message="This query may delete data. Execute it?"
          onDecision={onDecision}
        />,
      );
    });
    return onDecision;
  }

  it("keeps destructive copy visible and resolves an explicit execute", async () => {
    const onDecision = await render();

    expect(document.body.textContent).toContain("Confirm destructive SQL");
    expect(document.body.textContent).toContain("may delete data");
    const execute = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Execute SQL"),
    );
    await act(async () => execute?.click());

    expect(onDecision).toHaveBeenCalledWith(true);
  });

  it("treats cancellation as a rejected execution", async () => {
    const onDecision = await render();
    const cancel = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Cancel"),
    );
    await act(async () => cancel?.click());

    expect(onDecision).toHaveBeenCalledWith(false);
  });
});
