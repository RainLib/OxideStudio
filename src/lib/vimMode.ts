import type { editor } from "monaco-editor";
import type { VimCustomMapping, VimMappingMode } from "@/lib/appSettings";
import { expandVimLeader } from "@/lib/vimMappings";

type MonacoEditorLike = editor.IStandaloneCodeEditor;

type VimApi = {
  map: (lhs: string, rhs: string, mode?: Exclude<VimMappingMode, "all">) => void;
  noremap: (
    lhs: string,
    rhs: string,
    mode?: Exclude<VimMappingMode, "all">
  ) => void;
  unmap: (lhs: string, mode?: Exclude<VimMappingMode, "all">) => void;
  defineEx: (
    name: string,
    prefix: string,
    callback: (_editor: unknown, params: { args?: string[]; argString?: string }) => void
  ) => void;
};

export type VimModeController = {
  dispose: () => void;
};

export function restoreStandardEditorState(editor: MonacoEditorLike): void {
  editor.updateOptions({
    cursorBlinking: "blink",
    cursorStyle: "line",
  });
}

export async function attachVimMode(options: {
  editor: MonacoEditorLike;
  statusNode: HTMLElement | null;
  leader: string;
  mappings: VimCustomMapping[];
  onModeChange?: (mode: string) => void;
  onWrite?: () => void | Promise<unknown>;
  onQuit?: () => void | Promise<unknown>;
  onWriteQuit?: () => void | Promise<unknown>;
  onEdit?: (relativePath: string) => void | Promise<unknown>;
}): Promise<VimModeController> {
  const { initVimMode, VimMode } = await import("monaco-vim");
  const adapter = initVimMode(options.editor, options.statusNode);
  const vim = (VimMode as unknown as { Vim: VimApi }).Vim;
  const appliedMappings: Array<{
    lhs: string;
    mode?: Exclude<VimMappingMode, "all">;
  }> = [];

  if (options.onWrite) {
    vim.defineEx("write", "w", () => void options.onWrite?.());
  }
  if (options.onQuit) {
    vim.defineEx("quit", "q", () => void options.onQuit?.());
  }
  if (options.onWriteQuit) {
    vim.defineEx("writequit", "wq", () => void options.onWriteQuit?.());
  }
  if (options.onEdit) {
    vim.defineEx("edit", "e", (_editor, params) => {
      const relativePath =
        params.argString?.trim() || params.args?.join(" ").trim() || "";
      if (relativePath) void options.onEdit?.(relativePath);
    });
  }

  options.mappings.forEach((mapping) => {
    const lhs = expandVimLeader(mapping.lhs, options.leader);
    const rhs = expandVimLeader(mapping.rhs, options.leader);
    const mode = mapping.mode === "all" ? undefined : mapping.mode;
    if (mapping.recursive) {
      vim.map(lhs, rhs, mode);
    } else {
      vim.noremap(lhs, rhs, mode);
    }
    appliedMappings.push({ lhs, mode });
  });

  const handleModeChange = (event: { mode?: string }) => {
    options.onModeChange?.((event.mode || "normal").toUpperCase());
  };
  adapter.on("vim-mode-change", handleModeChange);
  options.onModeChange?.("NORMAL");

  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      adapter.off("vim-mode-change", handleModeChange);
      appliedMappings.forEach(({ lhs, mode }) => vim.unmap(lhs, mode));
      adapter.dispose();
      restoreStandardEditorState(options.editor);
    },
  };
}
