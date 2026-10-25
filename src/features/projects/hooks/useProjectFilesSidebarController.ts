import { useEffect, useMemo, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { compileProjectFileFilter, DEFAULT_PROJECT_FILE_FILTER } from "@/lib/projectFileFilter";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import { fileQueryFormat } from "@/features/file-query/model";
import { useFileQueryStore } from "@/features/file-query/store";
import { useProjectStore } from "@/store/useProjectStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  selectProjectFileTree,
  useProjectFilesStore,
  type ProjectFileTreeNode,
} from "@/store/useProjectFilesStore";
import { confirmDiscardProjectFileChanges, useTabStore } from "@/store/useTabStore";

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

export function useProjectFilesSidebarController() {
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
          !(await confirmDiscardProjectFileChanges(
            activeProjectId,
            "change the project directory"
          ))
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

  const queryNode = (node: ProjectFileTreeNode) => {
    if (!rootPath || node.kind !== "file" || node.isSymlink || !fileQueryFormat(node.name)) return;
    void useFileQueryStore.getState().show({ kind: "project", projectId: activeProjectId, expectedRoot: rootPath, relativePath: node.relativePath });
  };
  const openDataFile = () => void useFileQueryStore.getState().show({ kind: "picker", projectId: activeProjectId });
  const openAsText = async (node: ProjectFileTreeNode) => {
    try { await openProjectFileInEditor(node.relativePath); } catch { /* file store presents the read error */ }
  };

  const openNode = async (node: ProjectFileTreeNode) => {
    if (isLoading || isMutating) return;
    if (node.kind === "directory") {
      await toggleDirectory(node.relativePath);
      return;
    }
    if (node.isSymlink) return;
    if (["csv", "parquet"].includes(fileQueryFormat(node.name) ?? "")) { queryNode(node); return; }

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


  const rootDisplayName = rootPath
    ? projectRootName(rootPath, activeProjectName)
    : "";
  const hideSidebar = () => setToolWindowVisible("projectFiles", false);

  return {
    queryNode, openDataFile, openAsText,
    rootPath,
    rootDisplayName,
    isLoading,
    error,
    revisionConflict,
    loadTree,
    clearError,
    visibleTree,
    fileFilter,
    fileFilterDraft,
    setFileFilterDraft,
    fileFilterDialogOpen,
    setFileFilterDialogOpen,
    fileFilterError,
    setFileFilterError,
    selectedEntry,
    setSelectedEntry,
    entryDialog,
    setEntryDialog,
    entryName,
    setEntryName,
    dialogError,
    deleteTarget,
    setDeleteTarget,
    deleteError,
    setDeleteError,
    isMutating,
    saveFileFilter,
    chooseProjectDirectory,
    showCreateDialog,
    showRenameDialog,
    openNode,
    submitEntryDialog,
    confirmDelete,
    reloadConflictingFile,
    overwriteConflictingFile,
    hideSidebar,
  };
}
