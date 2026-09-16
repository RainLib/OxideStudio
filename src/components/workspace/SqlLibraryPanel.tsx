import { SqlLibraryPanelDialogs } from "@/features/saved-sql/ui/SqlLibraryPanelDialogs";
import { SqlLibraryPanelHeader } from "@/features/saved-sql/ui/SqlLibraryPanelHeader";
import { SqlLibraryTree } from "@/features/saved-sql/ui/SqlLibraryTree";
import type {
  SqlLibraryDeleteTarget,
  SqlLibraryEditDialog,
} from "@/features/saved-sql/ui/sqlLibraryPanelTypes";
import {
  savedSqlTreeRows,
  stripSqlExtension,
  type SavedSqlTreeRow,
} from "@/lib/savedSqlLibrary";
import { readSavedSqlDrag } from "@/lib/savedSqlDrag";
import { savedSqlService } from "@/services/tauri/saved-sql.service";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";

export function SqlLibraryPanel() {
  const setToolWindowVisible = useWorkbenchLayoutStore(
    (state) => state.setToolWindowVisible,
  );
  const projectId = useProjectStore((state) => state.activeProjectId);
  const projectName = useProjectStore((state) => state.activeProjectName);
  const folders = useSavedQueryStore((state) => state.folders);
  const files = useSavedQueryStore((state) => state.files);
  const isLoading = useSavedQueryStore((state) => state.isLoading);
  const storeError = useSavedQueryStore((state) => state.error);
  const createFolder = useSavedQueryStore((state) => state.createFolder);
  const renameFolder = useSavedQueryStore((state) => state.renameFolder);
  const moveFolder = useSavedQueryStore((state) => state.moveFolder);
  const deleteFolder = useSavedQueryStore((state) => state.deleteFolder);
  const saveQuery = useSavedQueryStore((state) => state.saveQuery);
  const importEntries = useSavedQueryStore((state) => state.importEntries);
  const updateQuery = useSavedQueryStore((state) => state.updateQuery);
  const moveQuery = useSavedQueryStore((state) => state.moveQuery);
  const deleteQuery = useSavedQueryStore((state) => state.deleteQuery);
  const openFile = useSavedQueryStore((state) => state.openFile);
  const ensureAllFileContents = useSavedQueryStore(
    (state) => state.ensureAllFileContents,
  );
  const createTab = useTabStore((state) => state.createTab);
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const connections = useConnectionStore((state) => state.connections);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<"folder" | "recent">("folder");
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<SqlLibraryEditDialog | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SqlLibraryDeleteTarget | null>(null);
  const [isMutating, setIsMutating] = useState(false);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const collapseSeedProject = useRef<string | null>(null);

  useEffect(() => {
    if (collapseSeedProject.current === projectId || folders.length === 0) return;
    collapseSeedProject.current = projectId;
    setCollapsedFolderIds(new Set(folders.map((folder) => folder.id)));
    setSelectedId(null);
  }, [folders, projectId]);

  const connectionNames = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection.name])),
    [connections],
  );
  const folderRows = useMemo(
    () =>
      savedSqlTreeRows({
        folders,
        files,
        collapsedFolderIds,
        query: deferredSearch,
      }),
    [collapsedFolderIds, deferredSearch, files, folders],
  );
  const rows = useMemo(() => {
    if (sortMode === "folder") return folderRows;
    const query = deferredSearch.trim().toLocaleLowerCase();
    return files
      .filter((file) =>
        query
          ? [file.name, file.databaseName, file.schemaName]
              .filter(Boolean)
              .some((value) => String(value).toLocaleLowerCase().includes(query))
          : true,
      )
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.name.localeCompare(right.name),
      )
      .map((file) => ({ kind: "file", file, depth: 0 }) satisfies SavedSqlTreeRow);
  }, [deferredSearch, files, folderRows, sortMode]);

  const scopeLabel = (connectionId?: string | null) =>
    connectionId
      ? connectionNames.get(connectionId) || "Deleted connection"
      : "Unassociated";

  const openSavedFile = async (fileId: string) => {
    setDialogError(null);
    try {
      const existing = useTabStore
        .getState()
        .tabs.find(
          (tab) =>
            tab.savedSqlProjectId === projectId && tab.savedSqlFileId === fileId,
        );
      if (existing) {
        useTabStore.getState().setActiveTab(existing.id);
        return;
      }
      const file = await openFile(fileId);
      if (!file) return;
      createTab("query", stripSqlExtension(file.name), file.sql, {
        connectionId: file.connectionId || undefined,
        databaseName: file.databaseName || undefined,
        schemaName: file.schemaName || undefined,
        savedSqlProjectId: file.projectId,
        savedSqlFileId: file.id,
      });
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    }
  };

  const beginDialog = (next: SqlLibraryEditDialog) => {
    setDialog(next);
    setDialogError(null);
    setDialogName(
      next.mode === "rename-folder"
        ? next.folder.name
        : next.mode === "rename-file"
          ? stripSqlExtension(next.file.name)
          : next.mode === "folder"
            ? "New folder"
            : "New query",
    );
  };

  const submitDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!dialog || !dialogName.trim()) return;
    setIsMutating(true);
    setDialogError(null);
    try {
      if (dialog.mode === "folder") {
        const folder = await createFolder(dialogName, {
          parentFolderId: dialog.parentFolderId,
          connectionId: dialog.connectionId,
        });
        setCollapsedFolderIds((current) => {
          const next = new Set(current);
          next.delete(folder.parentFolderId || "");
          next.add(folder.id);
          return next;
        });
      } else if (dialog.mode === "query") {
        const file = await saveQuery(dialogName, "", {
          connectionId: dialog.connectionId,
          folderId: dialog.folderId,
        });
        await openSavedFile(file.id);
      } else if (dialog.mode === "rename-folder") {
        await renameFolder(dialog.folder.id, dialogName);
      } else {
        const file = await useSavedQueryStore
          .getState()
          .ensureFileContent(dialog.file.id);
        if (file) await updateQuery(file.id, dialogName, file.sql);
      }
      setDialog(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsMutating(true);
    setDialogError(null);
    try {
      if (deleteTarget.kind === "folder") await deleteFolder(deleteTarget.item.id);
      else await deleteQuery(deleteTarget.item.id);
      setDeleteTarget(null);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  };

  const dropIntoFolder = async (
    event: DragEvent,
    folderId: string | null,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      if (draggedFolderId) {
        await moveFolder(draggedFolderId, folderId);
        setDraggedFolderId(null);
        return;
      }
      const payload = readSavedSqlDrag(event.dataTransfer);
      if (!payload || payload.projectId !== projectId) return;
      await moveQuery(payload.fileId, folderId);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    }
  };

  const importDirectory = async () => {
    setDialogError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Import SQL directory",
      });
      if (!selected || Array.isArray(selected)) return;
      setIsMutating(true);
      const entries = await savedSqlService.importDirectory(selected);
      await importEntries(entries, activeConnectionId);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  };

  const exportLibrary = async () => {
    setDialogError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Export SQL Library",
      });
      if (!selected || Array.isArray(selected)) return;
      setIsMutating(true);
      const byId = new Map(folders.map((folder) => [folder.id, folder]));
      const entries = [];
      const hydratedFiles = await ensureAllFileContents();
      for (const file of hydratedFiles) {
        const folderNames: string[] = [];
        let folder = file.folderId ? byId.get(file.folderId) : undefined;
        const seen = new Set<string>();
        while (folder && !seen.has(folder.id)) {
          seen.add(folder.id);
          folderNames.unshift(sanitizeExportSegment(folder.name));
          folder = folder.parentFolderId ? byId.get(folder.parentFolderId) : undefined;
        }
        entries.push({
          relativePath: [
            sanitizeExportSegment(scopeLabel(file.connectionId)),
            ...folderNames,
            sanitizeExportSegment(file.name),
          ].join("/"),
          sql: file.sql,
        });
      }
      await savedSqlService.exportDirectory(selected, entries);
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-panel))] text-[hsl(var(--wb-text))]">
      <SqlLibraryPanelHeader
        projectName={projectName}
        search={search}
        sortMode={sortMode}
        hasFolders={folders.length > 0}
        hasFiles={files.length > 0}
        isMutating={isMutating}
        onSearchChange={setSearch}
        onSortModeToggle={() => setSortMode((current) => (current === "folder" ? "recent" : "folder"))}
        onCollapseAll={() => setCollapsedFolderIds(new Set(folders.map((folder) => folder.id)))}
        onImport={() => void importDirectory()}
        onExport={() => void exportLibrary()}
        onCreateQuery={() => beginDialog({ mode: "query", connectionId: activeConnectionId })}
        onCreateFolder={() => beginDialog({ mode: "folder", connectionId: activeConnectionId })}
        onClose={() => setToolWindowVisible("sqlLibrary", false)}
      />

      <SqlLibraryTree
        isLoading={isLoading}
        rows={rows}
        search={search}
        selectedId={selectedId}
        collapsedFolderIds={collapsedFolderIds}
        scopeLabel={scopeLabel}
        onRootDrop={(event) => void dropIntoFolder(event, null)}
        onFolderDrop={(event, folderId) => void dropIntoFolder(event, folderId)}
        onSelect={setSelectedId}
        onToggleFolder={(folder) =>
          setCollapsedFolderIds((current) => {
            const next = new Set(current);
            if (next.has(folder.id)) next.delete(folder.id);
            else next.add(folder.id);
            return next;
          })
        }
        onCreateQuery={(folder) =>
          beginDialog({
            mode: "query",
            folderId: folder.id,
            connectionId: folder.connectionId,
          })
        }
        onCreateFolder={(folder) =>
          beginDialog({
            mode: "folder",
            parentFolderId: folder.id,
            connectionId: folder.connectionId,
          })
        }
        onRenameFolder={(folder) => beginDialog({ mode: "rename-folder", folder })}
        onDeleteFolder={(item) => setDeleteTarget({ kind: "folder", item })}
        onFolderDragStart={(folder) => setDraggedFolderId(folder.id)}
        onFolderDragEnd={() => setDraggedFolderId(null)}
        onOpenFile={(file) => void openSavedFile(file.id)}
        onRenameFile={(file) => beginDialog({ mode: "rename-file", file })}
        onDeleteFile={(item) => setDeleteTarget({ kind: "file", item })}
      />

      {(storeError || dialogError) && (
        <div className="shrink-0 border-t border-red-500/25 bg-red-500/10 px-2 py-1.5 text-[9px] leading-4 text-red-300">
          {dialogError || storeError}
        </div>
      )}

      <SqlLibraryPanelDialogs
        dialog={dialog}
        dialogName={dialogName}
        deleteTarget={deleteTarget}
        error={dialogError}
        isMutating={isMutating}
        onDialogOpenChange={(open) => !open && setDialog(null)}
        onDialogNameChange={setDialogName}
        onDialogSubmit={(event) => void submitDialog(event)}
        onDeleteOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirmDelete={() => void confirmDelete()}
      />
    </div>
  );
}


function sanitizeExportSegment(value: string) {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .trim()
    .replace(/[. ]+$/u, "");
  return sanitized || "untitled";
}
