import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProjectFileNode } from "@/features/projects/ui/ProjectFileNode";
import type { useProjectFilesSidebarController } from "@/features/projects/hooks/useProjectFilesSidebarController";
import { DEFAULT_PROJECT_FILE_FILTER } from "@/lib/projectFileFilter";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";

type ProjectFilesSidebarViewProps = ReturnType<typeof useProjectFilesSidebarController>;

export function ProjectFilesSidebarView({
  rootPath, rootDisplayName, isLoading, error, revisionConflict, loadTree, clearError,
  visibleTree, fileFilter, fileFilterDraft, setFileFilterDraft, fileFilterDialogOpen,
  setFileFilterDialogOpen, fileFilterError, setFileFilterError, selectedEntry, setSelectedEntry, entryDialog,
  setEntryDialog, entryName, setEntryName, dialogError, deleteTarget, setDeleteTarget,
  deleteError, setDeleteError, isMutating, saveFileFilter, chooseProjectDirectory,
  showCreateDialog, showRenameDialog, openNode, submitEntryDialog, confirmDelete,
  reloadConflictingFile, overwriteConflictingFile, hideSidebar,
}: ProjectFilesSidebarViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-panel))]">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.72)] px-2">
        {rootPath ? (
          <div
            className="flex min-w-0 items-center gap-1.5 text-[10px] text-[hsl(var(--wb-text-muted))]"
            title={rootPath}
            aria-label={`Project directory: ${rootPath}`}
          >
            <FolderOpen size={13} className="shrink-0 text-amber-400" />
            <span className="truncate font-medium text-[hsl(var(--wb-text))]">
              {rootDisplayName}
            </span>
          </div>
        ) : (
          <span />
        )}
        <div className="wb-tool-header-actions flex items-center gap-0.5">
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => showCreateDialog("file")}
            disabled={!rootPath || isLoading || isMutating}
            title="New File"
          >
            <FilePlus2 size={12} />
          </button>
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => showCreateDialog("directory")}
            disabled={!rootPath || isLoading || isMutating}
            title="New Folder"
          >
            <FolderPlus size={12} />
          </button>
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => void loadTree()}
            disabled={!rootPath || isLoading || isMutating}
            title="Refresh Files"
          >
            <RefreshCw size={12} className={cn(isLoading && "animate-spin")} />
          </button>
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => {
              setFileFilterDraft(fileFilter);
              setFileFilterError(null);
              setFileFilterDialogOpen(true);
            }}
            disabled={!rootPath}
            title={`File name filter: ${fileFilter}`}
            aria-label="Configure file name filter"
          >
            <Settings size={12} />
          </button>
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => void chooseProjectDirectory()}
            disabled={isLoading || isMutating}
            title={rootPath ? "Change Project Directory" : "Choose Project Directory"}
          >
            <FolderOpen size={12} />
          </button>
          <button
            type="button"
            className="wb-icon-button h-6 w-6"
            onClick={() => hideSidebar()}
            title="Hide Project Files"
            aria-label="Hide Project Files"
          >
            <X size={12} />
          </button>
        </div>
      </header>

      {revisionConflict && (
        <div className="m-2 rounded-[4px] border border-amber-500/35 bg-amber-500/10 p-2 text-[10px] text-amber-100">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <div className="font-semibold">File changed on disk</div>
              <div className="truncate opacity-80" title={revisionConflict.relativePath}>
                {revisionConflict.relativePath}
              </div>
              <div className="mt-2 flex gap-1">
                <button
                  type="button"
                  className="wb-text-button h-6 px-2"
                  onClick={() => void reloadConflictingFile()}
                >
                  Reload
                </button>
                <button
                  type="button"
                  className="wb-text-button h-6 px-2 text-amber-200"
                  onClick={() => void overwriteConflictingFile()}
                >
                  Overwrite
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && !revisionConflict && rootPath && (
        <div className="mx-2 mt-2 flex items-start gap-2 rounded-[4px] border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-200">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            className="shrink-0 opacity-70 hover:opacity-100"
            onClick={clearError}
            title="Dismiss"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {!rootPath ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))]">
            <FolderOpen size={19} className="text-amber-400" />
          </div>
          <div>
            <div className="text-[12px] font-medium text-[hsl(var(--wb-text))]">
              Add a project directory
            </div>
            <div className="mt-1 text-[10px] leading-4 wb-muted">
              Create, open, edit, and save SQL or text files inside the selected directory.
            </div>
          </div>
          <Button
            size="sm"
            className="wb-primary-button h-7 text-[11px]"
            onClick={() => void chooseProjectDirectory()}
          >
            Choose Directory
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1 custom-scrollbar">
          {visibleTree.length === 0 && !isLoading ? (
            <div className="px-4 py-8 text-center text-[10px] wb-muted">
              No files match {fileFilter}. Change the file filter or create a file.
            </div>
          ) : (
            visibleTree.map((node) => (
              <ProjectFileNode
                key={node.relativePath}
                node={node}
                depth={0}
                selectedPath={selectedEntry?.relativePath || null}
                onSelect={(entry) =>
                  setSelectedEntry({
                    relativePath: entry.relativePath,
                    kind: entry.kind,
                  })
                }
                onOpen={(entry) => void openNode(entry)}
                onRename={showRenameDialog}
                onDelete={(entry) => {
                  setDeleteError(null);
                  setDeleteTarget(entry);
                }}
                disabled={isLoading || isMutating}
              />
            ))
          )}
        </div>
      )}

      <Dialog open={fileFilterDialogOpen} onOpenChange={setFileFilterDialogOpen}>
        <DialogContent className="w-[440px] max-w-[calc(100vw-32px)] gap-0 rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
          <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
            <DialogTitle className="text-[13px]">File name filter</DialogTitle>
            <DialogDescription className="text-[10px] leading-4">
              Use a glob such as *.sql or *.sh, or a regular expression such as
              {" "}\\.(sql|sh|py)$.
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 py-4">
            <Input
              autoFocus
              value={fileFilterDraft}
              onChange={(event) => setFileFilterDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveFileFilter();
              }}
              className="wb-field font-mono"
              aria-label="File name filter"
              placeholder="*.sql"
            />
            {fileFilterError && (
              <div className="mt-2 text-[10px] text-red-300">{fileFilterError}</div>
            )}
          </div>
          <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setFileFilterDraft(DEFAULT_PROJECT_FILE_FILTER)}
            >
              Show all
            </Button>
            <Button
              type="button"
              size="sm"
              className="wb-primary-button"
              onClick={saveFileFilter}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(entryDialog)}
        onOpenChange={(open) => !open && setEntryDialog(null)}
      >
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] gap-0 rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
          <form onSubmit={submitEntryDialog}>
            <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <DialogTitle className="text-[13px]">
                {entryDialog?.mode === "rename"
                  ? "Rename Entry"
                  : entryDialog?.mode === "directory"
                    ? "New Folder"
                    : "New File"}
              </DialogTitle>
              {entryDialog?.mode !== "rename" && entryDialog?.parentPath && (
                <DialogDescription className="truncate text-[10px]">
                  In {entryDialog.parentPath}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="px-4 py-4">
              <Input
                autoFocus
                value={entryName}
                onChange={(event) => setEntryName(event.target.value)}
                className="wb-field"
                aria-label="Name"
              />
              {dialogError && (
                <div className="mt-2 text-[10px] text-red-300">{dialogError}</div>
              )}
            </div>
            <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] px-4 py-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEntryDialog(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="wb-primary-button"
                disabled={isMutating}
              >
                {entryDialog?.mode === "rename" ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription className="text-[11px] leading-5">
              {deleteTarget?.kind === "directory"
                ? "The folder and all files inside it will be permanently deleted."
                : "The file will be permanently deleted."}
            </DialogDescription>
            {deleteError && (
              <div className="mt-2 text-[10px] text-red-300">{deleteError}</div>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isMutating}
              onClick={() => void confirmDelete()}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}