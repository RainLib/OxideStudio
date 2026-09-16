import {
  APP_EVENT_INLINE_COMPLETION_ACCEPT,
  APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD,
  APP_EVENT_INLINE_COMPLETION_HIDE,
  APP_EVENT_INLINE_COMPLETION_TRIGGER,
  APP_EVENT_INSERT_LINE_BELOW,
} from "@/lib/actionEvents";
import {
  useEditorGroupStore,
  type EditorSplitDirection,
} from "@/store/useEditorGroupStore";
import { useTabStore } from "@/store/useTabStore";
import type { WorkbenchAction } from "./contracts";
import { dispatchWorkbenchActionEvent } from "./events";

function splitActiveEditor(direction: EditorSplitDirection): void {
  const { activeTabId, tabs } = useTabStore.getState();
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTabId || activeTab?.type !== "query") return;
  useEditorGroupStore.getState().split(direction, activeTabId);
}

export function createEditorSplitActions(): WorkbenchAction[] {
  return (
    [
      ["editor.splitLeft", "Split Editor Left", "left"],
      ["editor.splitRight", "Split Editor Right", "right"],
      ["editor.splitUp", "Split Editor Up", "up"],
      ["editor.splitDown", "Split Editor Down", "down"],
    ] as const
  ).map(([id, title, direction]) => ({
    id,
    title,
    group: "Editor" as const,
    run: () => splitActiveEditor(direction),
  }));
}

export function createEditorLineAction(): WorkbenchAction {
  return {
    id: "editor.insertLineBelow",
    title: "Insert Line Below",
    group: "Editor",
    run: () => dispatchWorkbenchActionEvent(APP_EVENT_INSERT_LINE_BELOW),
  };
}

export function createInlineCompletionActions(): WorkbenchAction[] {
  return [
    {
      id: "editor.inlineCompletion.trigger",
      title: "Trigger Inline Completion",
      group: "Editor",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_INLINE_COMPLETION_TRIGGER),
    },
    {
      id: "editor.inlineCompletion.accept",
      title: "Accept Inline Completion",
      group: "Editor",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_INLINE_COMPLETION_ACCEPT),
    },
    {
      id: "editor.inlineCompletion.acceptNextWord",
      title: "Accept Next Inline Completion Word",
      group: "Editor",
      run: () =>
        dispatchWorkbenchActionEvent(APP_EVENT_INLINE_COMPLETION_ACCEPT_NEXT_WORD),
    },
    {
      id: "editor.inlineCompletion.hide",
      title: "Hide Inline Completion",
      group: "Editor",
      run: () => dispatchWorkbenchActionEvent(APP_EVENT_INLINE_COMPLETION_HIDE),
    },
  ];
}
