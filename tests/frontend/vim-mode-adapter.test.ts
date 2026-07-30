/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachVimMode } from "@/lib/vimMode";

const mocks = vi.hoisted(() => ({
  adapter: {
    on: vi.fn(),
    off: vi.fn(),
    dispose: vi.fn(),
  },
  initVimMode: vi.fn(),
  map: vi.fn(),
  noremap: vi.fn(),
  unmap: vi.fn(),
  defineEx: vi.fn(),
  defineAction: vi.fn(),
  mapCommand: vi.fn(),
}));

vi.mock("monaco-vim", () => ({
  initVimMode: mocks.initVimMode,
  VimMode: {
    Vim: {
      map: mocks.map,
      noremap: mocks.noremap,
      unmap: mocks.unmap,
      defineEx: mocks.defineEx,
      defineAction: mocks.defineAction,
      mapCommand: mocks.mapCommand,
    },
  },
}));

describe("Vim mode adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initVimMode.mockReturnValue(mocks.adapter);
  });

  it("applies mappings, reports Normal mode, and disposes cleanly", async () => {
    const onModeChange = vi.fn();
    const onWrite = vi.fn();
    const onEdit = vi.fn();
    const onWindowNavigate = vi.fn();
    const statusNode = document.createElement("span");
    const editor = {
      updateOptions: vi.fn(),
    } as unknown as Parameters<typeof attachVimMode>[0]["editor"];
    const controller = await attachVimMode({
      editor,
      statusNode,
      leader: "<Space>",
      mappings: [
        {
          mode: "normal",
          lhs: "<leader>f",
          rhs: "/FROM<Enter>",
          recursive: false,
        },
        {
          mode: "insert",
          lhs: "jj",
          rhs: "<Esc>",
          recursive: true,
        },
      ],
      onModeChange,
      onWrite,
      onEdit,
      onWindowNavigate,
    });

    expect(mocks.initVimMode).toHaveBeenCalledWith(editor, statusNode);
    expect(mocks.noremap).toHaveBeenCalledWith(
      "<Space>f",
      "/FROM<Enter>",
      "normal"
    );
    expect(mocks.map).toHaveBeenCalledWith("jj", "<Esc>", "insert");
    expect(onModeChange).toHaveBeenCalledWith("NORMAL");
    expect(mocks.defineEx).toHaveBeenCalledWith(
      "write",
      "w",
      expect.any(Function)
    );
    const writeCommand = mocks.defineEx.mock.calls.find(
      ([name]) => name === "write"
    )?.[2];
    writeCommand?.({}, {});
    expect(onWrite).toHaveBeenCalledTimes(1);
    const editCommand = mocks.defineEx.mock.calls.find(
      ([name]) => name === "edit"
    )?.[2];
    editCommand?.({}, { argString: " queries/report.sql " });
    expect(onEdit).toHaveBeenCalledWith("queries/report.sql");
    expect(mocks.mapCommand).toHaveBeenCalledWith(
      "<C-w>h",
      "action",
      expect.any(String),
      {},
      { context: "normal" },
    );
    const leftActionName = mocks.mapCommand.mock.calls.find(
      ([keys]) => keys === "<C-w>h",
    )?.[2];
    const leftAction = mocks.defineAction.mock.calls.find(
      ([name]) => name === leftActionName,
    )?.[1];
    leftAction?.({}, {});
    expect(onWindowNavigate).toHaveBeenCalledWith("left");

    controller.dispose();
    expect(mocks.unmap).toHaveBeenCalledWith("<Space>f", "normal");
    expect(mocks.unmap).toHaveBeenCalledWith("jj", "insert");
    expect(mocks.unmap).toHaveBeenCalledWith("<C-w>h", "normal");
    expect(mocks.adapter.dispose).toHaveBeenCalledTimes(1);
    expect(editor.updateOptions).toHaveBeenCalledWith({
      cursorBlinking: "blink",
      cursorStyle: "line",
    });

    controller.dispose();
    expect(mocks.adapter.dispose).toHaveBeenCalledTimes(1);
  });
});
