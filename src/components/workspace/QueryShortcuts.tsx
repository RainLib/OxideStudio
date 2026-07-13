import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actions";
import { requestProjectFilesPanel } from "@/lib/projectFilesNavigation";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { FileCode2, FolderTree, Search } from "lucide-react";

const shortcutCardClass =
  "flex min-h-24 flex-col items-start justify-between rounded-[6px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-3 text-left hover:border-[hsl(var(--wb-accent)/0.45)] hover:bg-[hsl(var(--wb-hover))]";

export function QueryShortcuts() {
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId
  );
  const currentSchema = useSchemaStore((state) => state.currentSchema);

  const createQuery = () => {
    useTabStore.getState().createTab("query", "New Query", "", {
      connectionId: activeConnectionId || undefined,
      schemaName: currentSchema || undefined,
    });
  };

  const openProjectFiles = () => {
    requestProjectFilesPanel();
  };

  return (
    <div className="h-full w-full select-none overflow-hidden bg-[hsl(var(--wb-editor))]">
      <div className="flex h-full items-center justify-center">
        <div className="w-[420px] max-w-[calc(100vw-72px)] translate-y-[-14px]">
          <div className="mb-4 text-center">
            <div className="text-[14px] font-semibold text-[hsl(var(--wb-text))]">
              Start working with SQL
            </div>
            <div className="mt-1 text-[11px] wb-muted">
              Open a console or keep queries as files in your project directory.
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              className={shortcutCardClass}
              onClick={createQuery}
            >
              <FileCode2 size={17} className="text-sky-400" />
              <span>
                <span className="block text-[11px] font-semibold text-[hsl(var(--wb-text))]">
                  New Query
                </span>
                <span className="mt-0.5 block text-[9px] leading-3.5 wb-muted">
                  Open a SQL console
                </span>
              </span>
            </button>
            <button
              type="button"
              className={shortcutCardClass}
              onClick={openProjectFiles}
            >
              <FolderTree size={17} className="text-amber-400" />
              <span>
                <span className="block text-[11px] font-semibold text-[hsl(var(--wb-text))]">
                  Project Files
                </span>
                <span className="mt-0.5 block text-[9px] leading-3.5 wb-muted">
                  Create or open files
                </span>
              </span>
            </button>
            <button
              type="button"
              className={shortcutCardClass}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent(APP_EVENT_OPEN_COMMAND_PALETTE)
                )
              }
            >
              <Search size={17} className="text-violet-400" />
              <span>
                <span className="block text-[11px] font-semibold text-[hsl(var(--wb-text))]">
                  Find an Action
                </span>
                <span className="mt-0.5 block text-[9px] leading-3.5 wb-muted">
                  Open command palette
                </span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
