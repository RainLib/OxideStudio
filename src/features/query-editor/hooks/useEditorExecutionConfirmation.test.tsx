import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { useEditorExecutionConfirmation } from "./useEditorExecutionConfirmation";

// @vitest-environment happy-dom

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
let controller: ReturnType<typeof useEditorExecutionConfirmation>;
const focus = vi.fn();
const editorRef = {
  current: { focus } as unknown as editor.IStandaloneCodeEditor,
};

function Harness() {
  controller = useEditorExecutionConfirmation({
    editorRef,
    driver: "postgres",
    editorSettings: {
      ...DEFAULT_APP_SETTINGS.editor,
      confirmDestructiveSql: true,
    },
  });
  return <span>{controller.dangerousExecution?.message}</span>;
}

beforeEach(async () => {
  focus.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("resolves the superseded request before showing the next confirmation", async () => {
  let first!: boolean | Promise<boolean>;
  let second!: boolean | Promise<boolean>;
  await act(async () => {
    first = controller.confirmEditorExecution("DROP TABLE first_table");
  });
  expect(controller.dangerousExecution).not.toBeNull();
  await act(async () => {
    second = controller.confirmEditorExecution("DROP TABLE second_table");
  });
  await expect(first).resolves.toBe(false);
  await act(async () => controller.resolveDangerousExecution(true));
  await expect(second).resolves.toBe(true);
  expect(controller.dangerousExecution).toBeNull();
});

it("settles pending confirmation as declined when its editor unmounts", async () => {
  let pending!: boolean | Promise<boolean>;
  await act(async () => {
    pending = controller.confirmEditorExecution("DROP TABLE abandoned_table");
  });
  await act(async () => root.render(null));
  await expect(pending).resolves.toBe(false);
});

it("does not restore editor focus over a newer confirmation", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  expect(controller.confirmEditorExecution("SELECT 1")).toBe(true);
  let first!: boolean | Promise<boolean>;
  await act(async () => {
    first = controller.confirmEditorExecution("DROP TABLE first_table");
  });
  await act(async () => controller.resolveDangerousExecution(false));
  await expect(first).resolves.toBe(false);
  const closeEvent = new Event("closeAutoFocus", { cancelable: true });
  controller.restoreDangerousExecutionFocus(closeEvent);
  expect(closeEvent.defaultPrevented).toBe(true);
  let second!: boolean | Promise<boolean>;
  await act(async () => {
    second = controller.confirmEditorExecution("DROP TABLE second_table");
  });
  frames.shift()?.(0);
  expect(focus).not.toHaveBeenCalled();
  await act(async () => controller.resolveDangerousExecution(false));
  await expect(second).resolves.toBe(false);
  controller.restoreDangerousExecutionFocus(new Event("closeAutoFocus"));
  frames.shift()?.(0);
  expect(focus).toHaveBeenCalledOnce();
});
