/**
 * @vitest-environment happy-dom
 */
import { SqlParametersPanel } from "@/components/workspace/SqlParametersPanel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setControlValue(control: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    control instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SqlParametersPanel", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
  });

  it("requires explicit values and runs a compiled copy without changing the source", async () => {
    const source =
      "SELECT * FROM users WHERE name = :name AND deleted_at IS :deleted";
    const onRun = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <SqlParametersPanel
          sql={source}
          isConnected
          isExecuting={false}
          onClose={vi.fn()}
          onRun={onRun}
        />
      );
    });

    const runButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Run generated SQL")
    );
    expect(runButton?.disabled).toBe(true);
    expect(container.textContent).toContain("editor text stays unchanged");

    await act(async () => {
      const nameInput = container.querySelector<HTMLInputElement>(
        '[aria-label="Value for :name"]'
      );
      const deletedMode = container.querySelector<HTMLSelectElement>(
        '[aria-label="Value type for :deleted"]'
      );
      if (!nameInput || !deletedMode) throw new Error("Parameter controls missing");
      setControlValue(nameInput, "O'Reilly");
      setControlValue(deletedMode, "null");
    });

    expect(runButton?.disabled).toBe(false);
    await act(async () => runButton?.click());

    expect(onRun).toHaveBeenCalledWith(
      "SELECT * FROM users WHERE name = 'O''Reilly' AND deleted_at IS NULL"
    );
    expect(source).toBe(
      "SELECT * FROM users WHERE name = :name AND deleted_at IS :deleted"
    );
  });

  it("makes raw SQL mode explicit in both controls and warning copy", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <SqlParametersPanel
          sql="SELECT * FROM :table LIMIT :limit"
          isConnected
          isExecuting={false}
          onClose={vi.fn()}
          onRun={vi.fn()}
        />
      );
    });

    await act(async () => {
      const tableMode = container.querySelector<HTMLSelectElement>(
        '[aria-label="Value type for :table"]'
      );
      const tableValue = container.querySelector<HTMLInputElement>(
        '[aria-label="Value for :table"]'
      );
      if (!tableMode || !tableValue) throw new Error("Raw controls missing");
      setControlValue(tableMode, "raw");
      setControlValue(tableValue, "public.users");
    });

    expect(container.textContent).toContain(
      "Raw SQL is inserted without quoting"
    );
    expect(container.textContent).toContain("SELECT * FROM public.users LIMIT :limit");
  });
});
