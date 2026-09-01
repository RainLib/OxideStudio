import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/store/useProjectStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  selectProjectFileTree,
  useProjectFilesStore,
  type ProjectFileTreeNode,
} from "@/store/useProjectFilesStore";
import {
  confirmDiscardProjectFileChanges,
  useTabStore,
} from "@/store/useTabStore";
import { open } from "@tauri-apps/plugin-dialog";
import { supportsProjectFilePreview } from "@/services/tauri/project-files.service";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import {
  compileProjectFileFilter,
  DEFAULT_PROJECT_FILE_FILTER,
} from "@/lib/projectFileFilter";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type SelectedEntry = Pick<ProjectFileTreeNode, "relativePath" | "kind">;

type EntryDialogState =
  | {
      mode: "file" | "directory";
      parentPath: string;
    }
  | {
      mode: "rename";
      entry: ProjectFileTreeNode;
    };

function parentPath(relativePath: string) {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

function joinPath(directoryPath: string, name: string) {
  return directoryPath ? `${directoryPath}/${name}` : name;
}

function isSqlFile(name: string) {
  return /\.(sql|psql|mysql|pgsql)$/i.test(name);
}

const PROJECT_FILE_FILTER_STORAGE_KEY = "oxide-project-file-filter";

function storedProjectFileFilter() {
  try {
    return localStorage.getItem(PROJECT_FILE_FILTER_STORAGE_KEY) || DEFAULT_PROJECT_FILE_FILTER;
  } catch {
    return DEFAULT_PROJECT_FILE_FILTER;
  }
}

function filterProjectFileTree(
  nodes: ProjectFileTreeNode[],
  fileFilter: RegExp,
): ProjectFileTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === "file") return fileFilter.test(node.name) ? [node] : [];
    return [
      { ...node, children: filterProjectFileTree(node.children || [], fileFilter) },
    ];
  });
}

function projectRootName(rootPath: string, fallback: string) {
  const normalized = rootPath.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || fallback;
}

function replaceOpenDocument(
  projectId: string,
  relativePath: string,
  content: string,
  revision: string
) {
  useTabStore.setState((state) => ({
    tabs: state.tabs.map((tab) =>
      tab.fileProjectId === projectId &&
      tab.fileRelativePath === relativePath
        ? {
            ...tab,
            sql: content,
            fileRevision: revision,
            isDirty: false,
            fileError: null,
          }
        : tab
    ),
  }));
}

interface ProjectFileNodeProps {
  node: ProjectFileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: ProjectFileTreeNode) => void;
  onOpen: (node: ProjectFileTreeNode) => void;
  onRename: (node: ProjectFileTreeNode) => void;
  onDelete: (node: ProjectFileTreeNode) => void;
  disabled?: boolean;
}

function ProjectFileNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onOpen,
  onRename,
  onDelete,
  disabled = false,
}: ProjectFileNodeProps) {
  const isDirectory = node.kind === "directory";
  const isImage = supportsProjectFilePreview(node.name);
  const FileIcon = isImage
    ? ImageIcon
    : isSqlFile(node.name)
      ? FileCode2
      : FileText;

  return (
    <>
      <div
        className={cn(
          "group flex h-6 items-center pr-1 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
          selectedPath === node.relativePath &&
            "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]"
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
      >
        <button
          type="button"
          disabled={disabled}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            onSelect(node);
            onOpen(node);
          }}
          title={node.relativePath}
        >
          {isDirectory ? (
            node.isLoading ? (
              <LoaderCircle size={12} className="shrink-0 animate-spin" />
            ) : node.isExpanded ? (
              <ChevronDown size={12} className="shrink-0" />
            ) : (
              <ChevronRight size={12} className="shrink-0" />
            )
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {isDirectory ? (
            node.isExpanded ? (
              <FolderOpen size={13} className="shrink-0 text-amber-400" />
            ) : (
              <Folder size={13} className="shrink-0 text-amber-400" />
            )
          ) : (
            <FileIcon
              size={13}
              className={cn(
                "shrink-0",
                isImage
                  ? "text-violet-400"
                  : isSqlFile(node.name)
                    ? "text-sky-400"
                    : "wb-muted"
              )}
            />
          )}
          <span className="truncate">{node.name}</span>
          {node.isSymlink && (
            <span className="ml-auto text-[9px] text-amber-400" title="Linked entry">
              link
            </span>
          )}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="wb-icon-button h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              title={`Actions for ${node.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[150px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[11px]"
          >
            <DropdownMenuItem
              className="h-7 text-[11px]"
              disabled={disabled}
              onClick={() => onRename(node)}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="h-7 text-[11px] text-red-400 focus:text-red-300"
              disabled={disabled}
              onClick={() => onDelete(node)}
            >
              <Trash2 size={12} className="mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {node.isExpanded &&
        node.children?.map((child) => (
          <ProjectFileNode
            key={child.relativePath}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onOpen={onOpen}
            onRename={onRename}
            onDelete={onDelete}
            disabled={disabled}
          />
        ))}
    </>
  );
}

export function ProjectFilesSidebar() {
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (state) => state.setToolWindowVisible,
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProjectName = useProjectStore((state) => state.activeProjectName);
  const activeProjectRoot = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.root_path || null
  );
  const fileState = useProjectFilesStore();
  const {
    rootPath,
    isLoading,
    error,
    revisionConflict,
    syncActiveProject,
    setRootPath,
    loadTree,
    toggleDirectory,
    readFile,
    createFile,
    createDirectory,
    writeFile,
    renameEntry,
    deleteEntry,
    clearError,
    clearRevisionConflict,
  } = fileState;
  const tree = useMemo(
    () => selectProjectFileTree(fileState),
    [
      fileState.entriesByDirectory,
      fileState.expandedDirectories,
      fileState.loadingDirectories,
    ]
  );
  const [fileFilter, setFileFilter] = useState(storedProjectFileFilter);
  const [fileFilterDraft, setFileFilterDraft] = useState(fileFilter);
  const [fileFilterDialogOpen, setFileFilterDialogOpen] = useState(false);
  const [fileFilterError, setFileFilterError] = useState<string | null>(null);
  const compiledFileFilter = useMemo(
    () => compileProjectFileFilter(fileFilter),
    [fileFilter],
  );
  const visibleTree = useMemo(
    () => filterProjectFileTree(tree, compiledFileFilter),
    [compiledFileFilter, tree],
  );
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null);
  const [entryDialog, setEntryDialog] = useState<EntryDialogState | null>(null);
  const [entryName, setEntryName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFileTreeNode | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const saveFileFilter = () => {
    try {
      const normalized = fileFilterDraft.trim() || DEFAULT_PROJECT_FILE_FILTER;
      compileProjectFileFilter(normalized);
      localStorage.setItem(PROJECT_FILE_FILTER_STORAGE_KEY, normalized);
      setFileFilter(normalized);
      setFileFilterDraft(normalized);
      setFileFilterError(null);
      setFileFilterDialogOpen(false);
    } catch (cause) {
      setFileFilterError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    syncActiveProject();
    setSelectedEntry(null);
    if (activeProjectRoot) void loadTree();
  }, [activeProjectId, activeProjectRoot, loadTree, syncActiveProject]);

  const selectedDirectory =
    selectedEntry?.kind === "directory"
      ? selectedEntry.relativePath
      : selectedEntry
        ? parentPath(selectedEntry.relativePath)
        : "";

  const chooseProjectDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: `Choose a directory for ${activeProjectName}`,
      });
      if (typeof selected === "string" && selected !== rootPath) {
        if (
          !confirmDiscardProjectFileChanges(
            activeProjectId,
            "change the project directory"
          )
        ) {
          return;
        }
        const tabState = useTabStore.getState();
        const openSnapshots = tabState.tabs.flatMap((tab, index) =>
          tab.fileProjectId === activeProjectId ? [{ tab, index }] : []
        );
        const closedSnapshots = tabState.closedTabsStack.filter(
          (tab) => tab.fileProjectId === activeProjectId
        );
        const previousActiveTabId = tabState.activeTabId;
        tabState.discardProjectFileTabs(activeProjectId, "", false);
        try {
          await setRootPath(selected);
          tabState.discardProjectFileTabs(activeProjectId, "");
        } catch (cause) {
          useTabStore.setState((state) => {
            const tabs = [...state.tabs];
            for (const snapshot of openSnapshots) {
              if (tabs.some((tab) => tab.id === snapshot.tab.id)) continue;
              tabs.splice(Math.min(snapshot.index, tabs.length), 0, snapshot.tab);
            }
            const closedIds = new Set(
              state.closedTabsStack.map((tab) => tab.id)
            );
            const closedTabsStack = [
              ...closedSnapshots.filter((tab) => !closedIds.has(tab.id)),
              ...state.closedTabsStack,
            ];
            return {
              tabs,
              activeTabId:
                previousActiveTabId &&
                openSnapshots.some(
                  (snapshot) => snapshot.tab.id === previousActiveTabId
                )
                  ? previousActiveTabId
                  : state.activeTabId,
              closedTabsStack,
            };
          });
          throw cause;
        }
      }
    } catch (cause) {
      useProjectFilesStore.setState({
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };

  const openNode = async (node: ProjectFileTreeNode) => {
    if (isLoading || isMutating) return;
    if (node.kind === "directory") {
      await toggleDirectory(node.relativePath);
      return;
    }
    if (node.isSymlink) return;

    try {
      await openProjectFileInEditor(node.relativePath);
    } catch {
      // The store exposes the actionable read error in the explorer.
    }
  };

  const showCreateDialog = (mode: "file" | "directory") => {
    setEntryDialog({ mode, parentPath: selectedDirectory });
    setEntryName(mode === "file" ? "query.sql" : "New Folder");
    setDialogError(null);
  };

  const showRenameDialog = (entry: ProjectFileTreeNode) => {
    setEntryDialog({ mode: "rename", entry });
    setEntryName(entry.name);
    setDialogError(null);
  };

  const submitEntryDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = entryName.trim();
    if (!name) {
      setDialogError("Enter a name.");
      return;
    }
    if (name.includes("/") || name.includes("\\")) {
      setDialogError("Enter a single file or folder name, without path separators.");
      return;
    }
    if (!entryDialog) return;

    setIsMutating(true);
    setDialogError(null);
    try {
      if (entryDialog.mode === "rename") {
        const nextPath = joinPath(
          parentPath(entryDialog.entry.relativePath),
          name
        );
        if (nextPath !== entryDialog.entry.relativePath) {
          await renameEntry(entryDialog.entry.relativePath, nextPath);
          useTabStore
            .getState()
            .renameProjectFileTabs(
              activeProjectId,
              entryDialog.entry.relativePath,
              nextPath
            );
          setSelectedEntry({
            relativePath: nextPath,
            kind: entryDialog.entry.kind,
          });
        }
      } else {
        const relativePath = joinPath(entryDialog.parentPath, name);
        if (entryDialog.mode === "directory") {
          await createDirectory(relativePath);
          setSelectedEntry({ relativePath, kind: "directory" });
        } else {
          const document = await createFile(relativePath);
          useTabStore
            .getState()
            .openProjectFileTab(
              activeProjectId,
              document.relativePath,
              document.content,
              document.revision,
              rootPath
            );
          setSelectedEntry({ relativePath, kind: "file" });
        }
      }
      setEntryDialog(null);
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsMutating(true);
    setDeleteError(null);
    try {
      await deleteEntry(
        deleteTarget.relativePath,
        deleteTarget.kind === "directory"
      );
      useTabStore
        .getState()
        .discardProjectFileTabs(activeProjectId, deleteTarget.relativePath);
      if (
        selectedEntry &&
        (selectedEntry.relativePath === deleteTarget.relativePath ||
          selectedEntry.relativePath.startsWith(`${deleteTarget.relativePath}/`))
      ) {
        setSelectedEntry(null);
      }
      setDeleteTarget(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsMutating(false);
    }
  };

  const reloadConflictingFile = async () => {
    if (!revisionConflict) return;
    try {
      const document = await readFile(revisionConflict.relativePath);
      replaceOpenDocument(
        activeProjectId,
        document.relativePath,
        document.content,
        document.revision
      );
      clearRevisionConflict();
      clearError();
    } catch {
      // The explorer keeps the conflict and shows the latest read error.
    }
  };

  const overwriteConflictingFile = async () => {
    if (!revisionConflict) return;
    try {
      const latest = await readFile(revisionConflict.relativePath);
      const document = await writeFile(
        revisionConflict.relativePath,
        revisionConflict.attemptedContent,
        latest.revision
      );
      replaceOpenDocument(
        activeProjectId,
        document.relativePath,
        document.content,
        document.revision
      );
      clearRevisionConflict();
      clearError();
    } catch {
      // A second external edit remains a conflict and must be resolved again.
    }
  };

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
              {projectRootName(rootPath, activeProjectName)}
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
            onClick={() => setToolWindowVisible("projectFiles", false)}
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
