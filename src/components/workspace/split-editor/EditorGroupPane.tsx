import { cn } from "@/lib/utils";
import type {
  EditorGroupId,
  EditorGroupNode,
} from "@/store/useEditorGroupStore";
import type { VimWindowNavigation } from "@/lib/vimMode";
import { QueryEditor } from "../QueryEditor";
import { TabBar } from "../TabBar";

type EditorGroupPaneProps = {
  group: EditorGroupNode;
  activeGroup: EditorGroupId;
  fallbackTabId: string | null;
  groupLayoutClass: string;
  queryTabIds: ReadonlySet<string>;
  activate: (group: EditorGroupId, tabId: string) => void;
  close: (group: EditorGroupId) => void;
  vimNavigationHandlers: ReadonlyMap<
    EditorGroupId,
    (direction: VimWindowNavigation) => void
  >;
};

export function EditorGroupPane({
  group,
  activeGroup,
  fallbackTabId,
  groupLayoutClass,
  queryTabIds,
  activate,
  close,
  vimNavigationHandlers,
}: EditorGroupPaneProps) {
  const tabId =
    group.tabId && queryTabIds.has(group.tabId) ? group.tabId : fallbackTabId;
  if (!tabId) return null;
  const isActive = group.id === activeGroup;

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 overflow-hidden bg-[hsl(var(--wb-editor))]",
        groupLayoutClass,
        isActive && "shadow-[inset_0_0_0_1px_hsl(var(--wb-accent)/0.42)]",
      )}
      onPointerDown={() => activate(group.id, tabId)}
      data-editor-group={group.id}
    >
      <TabBar
        activeTabIdOverride={tabId}
        queryOnly
        compact
        onSelectTab={(nextTabId) => activate(group.id, nextTabId)}
        onCloseGroup={() => close(group.id)}
      />
      <div className="min-h-0 min-w-0 flex-1">
        <QueryEditor
          tabId={tabId}
          isActivePane={isActive}
          editorGroupId={group.id}
          onActivate={() => activate(group.id, tabId)}
          onVimWindowNavigate={vimNavigationHandlers.get(group.id)}
        />
      </div>
    </section>
  );
}
