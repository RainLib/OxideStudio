/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flattenJsonTreeRows,
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

  it("explains why generated database columns are read-only", async () => {
    await renderDialog({
      ...baseTarget,
      editable: false,
      readOnlyReason: "generated-column",
    });

    expect(document.body.textContent).toContain(
      "Generated database columns are computed and cannot be edited.",
    );
    expect(document.body.textContent).not.toContain("Stage change");
  });

  it("does not allow a write when column ownership metadata is unavailable", async () => {
    await renderDialog({
      ...baseTarget,
      editable: false,
      readOnlyReason: "unclassified-column",
    });

    expect(document.body.textContent).toContain(
      "Column write metadata is unavailable, so editing is disabled.",
    );
    expect(document.body.textContent).not.toContain("Stage change");
  });

  it("inspects valid JSON as a read-only tree without replacing the staging draft", async () => {
    const { onStageValue } = await renderDialog(baseTarget);
    await act(async () => button("Tree").click());

    expect(document.body.textContent).toContain("$");
    expect(document.body.textContent).toContain("role");
    expect(document.body.textContent).toContain('"admin"');
    expect(
      document.body.querySelector('[aria-label="Show JSON text"]')?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    await act(async () => button("Stage change").click());
    expect(onStageValue).toHaveBeenCalledWith({ role: "admin" });
  });

  it("flattens expanded JSON iteratively with stable pointer paths and closing rows", () => {
    const rows = flattenJsonTreeRows(
      { "a/b": { "x~y": 1 } },
      new Set(["", "/a~1b"]),
    );

    expect(rows.map((row) => row.path)).toEqual([
      "",
      "/a~1b",
      "/a~1b/x~0y",
      "/a~1b/$close\u0000",
      "/$close\u0000",
    ]);
    expect(rows.filter((row) => row.closing)).toHaveLength(2);
  });

  it("bounds the traversal stack as well as the rendered JSON rows", () => {
    const value = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`key_${index}`, index]),
    );
    const rows = flattenJsonTreeRows(value, new Set([""]), 20);

    expect(rows.length).toBeLessThanOrEqual(21);
    expect(rows.at(-1)?.truncated).toBe(true);
    expect(rows.some((row) => row.path === "/key_4999")).toBe(false);
  });

  it("virtualizes wide JSON trees instead of mounting every row", async () => {
    const value = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`key_${index}`, index]),
    );
    await renderDialog({
      ...baseTarget,
      value,
      originalValue: value,
    });
    await act(async () => button("Tree").click());

    expect(
      document.body.querySelector('[data-json-tree-virtualized="true"]'),
    ).not.toBeNull();
    expect(document.body.querySelectorAll("[data-json-path]").length).toBeLessThan(
      100,
    );
    expect(document.body.textContent).toContain("key_0");
    expect(
      document.body.querySelector('[data-json-path="/key_4999"]'),
    ).toBeNull();
  });

  it("offers an XML tree preview while preserving the staged XML source", async () => {
    const target = {
      ...baseTarget,
      columnType: "xml",
      value: '<role active="true"><name>admin</name></role>',
      originalValue: '<role active="true"><name>admin</name></role>',
    };
    const { onStageValue } = await renderDialog(target);
    await act(async () => button("Tree").click());

    expect(document.body.textContent).toContain("role");
    expect(document.body.textContent).toContain("2 properties");

    await act(async () => button("Stage change").click());
    expect(onStageValue).toHaveBeenCalledWith('<role active="true"><name>admin</name></role>');
  });

  it("renders raster image values only through an inert data URL preview", async () => {
    await renderDialog({
      ...baseTarget,
      columnType: "image",
      value: "data:image/png;base64,AA==",
      originalValue: "data:image/png;base64,AA==",
    });
    await act(async () => button("Preview").click());

    const preview = document.body.querySelector<HTMLImageElement>(
      'img[alt="Database image value preview"]',
    );
    expect(preview?.src).toContain("data:image/png;base64,AA==");
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
