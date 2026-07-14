/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ValueEditorDialog,
  type ValueEditorTarget,
} from "@/components/workspace/ValueEditorDialog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/theme/useTheme", () => ({
  useTheme: () => ({ mode: "dark" }),
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange?: (value: string) => void;
    options?: { readOnly?: boolean };
  }) => (
    <textarea
      aria-label="Value content"
      value={value}
      readOnly={options?.readOnly}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

const baseTarget: ValueEditorTarget = {
  key: "tab-1:0:1",
  columnName: "payload",
  columnType: "jsonb",
  rowLabel: "Row 1",
  value: { role: "admin" },
  originalValue: { role: "admin" },
  editable: true,
  nullable: true,
  pending: false,
};

describe("ValueEditorDialog", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function renderDialog(
    target: ValueEditorTarget,
    onStageValue = vi.fn(),
    onOpenChange = vi.fn(),
  ) {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ValueEditorDialog
          open
          target={target}
          onOpenChange={onOpenChange}
          onStageValue={onStageValue}
        />,
      );
    });
    return { onStageValue, onOpenChange };
  }

  it("validates JSON and stages a structured value through the table draft path", async () => {
    const { onStageValue, onOpenChange } = await renderDialog(baseTarget);
    const editor = document.body.querySelector<HTMLTextAreaElement>(
      '[aria-label="Value content"]',
    );
    expect(editor?.value).toContain('"role": "admin"');

    await act(async () => {
      if (!editor) throw new Error("editor missing");
      setTextareaValue(editor, "{broken");
      button("Stage change").click();
    });
    expect(
      document.body.querySelector('[role="alert"]')?.textContent,
    ).toContain("Invalid JSON");
    expect(onStageValue).not.toHaveBeenCalled();

    await act(async () => {
      if (!editor) throw new Error("editor missing");
      setTextareaValue(editor, '{"role":"owner"}');
      button("Stage change").click();
    });
    expect(onStageValue).toHaveBeenCalledWith({ role: "owner" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("makes an unloaded database default distinct and requires an explicit state", async () => {
    const onStageValue = vi.fn();
    await renderDialog(
      {
        ...baseTarget,
        columnName: "note",
        columnType: "text",
        value: undefined,
        originalValue: undefined,
        defaultValue: "generated note",
      },
      onStageValue,
    );

    expect(document.body.textContent).toContain("No value is loaded");
    expect(document.body.textContent).toContain("Default: generated note");
    expect(button("Stage change").disabled).toBe(true);

    await act(async () => button("Empty string").click());
    expect(document.body.textContent).toContain("exactly zero characters");
    expect(button("Stage change").disabled).toBe(false);

    await act(async () => button("Stage change").click());
    expect(onStageValue).toHaveBeenCalledWith("");
  });

  it("keeps query-result values read-only", async () => {
    await renderDialog({
      ...baseTarget,
      editable: false,
      value: null,
      originalValue: null,
    });

    expect(document.body.textContent).toContain("Query results are read-only");
    expect(document.body.textContent).toContain("This is SQL NULL");
    expect(document.body.textContent).not.toContain("Stage change");
    expect(button("Close")).toBeTruthy();
  });

  it("can open after mounting without a target", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <ValueEditorDialog
          open={false}
          target={null}
          onOpenChange={vi.fn()}
          onStageValue={vi.fn()}
        />,
      );
    });

    await act(async () => {
      root?.render(
        <ValueEditorDialog
          open
          target={baseTarget}
          onOpenChange={vi.fn()}
          onStageValue={vi.fn()}
        />,
      );
    });

    expect(document.body.textContent).toContain("payload");
    expect(document.body.textContent).toContain("Structured value");
  });
});

function button(label: string) {
  const match = Array.from(document.body.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim().startsWith(label),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${label}`);
  }
  return match;
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}
