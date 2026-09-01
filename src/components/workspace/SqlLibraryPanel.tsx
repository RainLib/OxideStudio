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
import {
  savedSqlTreeRows,
  stripSqlExtension,
  type SavedSqlTreeRow,
} from "@/lib/savedSqlLibrary";
import { readSavedSqlDrag, writeSavedSqlDrag } from "@/lib/savedSqlDrag";
import type {
  SavedSqlFile,
  SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import { savedSqlService } from "@/services/tauri/saved-sql.service";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import {
  ArrowDownWideNarrow,
  ChevronsDownUp,
  ChevronRight,
  FileCode2,
  FilePlus2,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Library,
  LoaderCircle,
  MoreHorizontal,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

type EditDialog =
  | { mode: "folder"; parentFolderId?: string | null; connectionId?: string | null }
  | { mode: "query"; folderId?: string | null; connectionId?: string | null }
  | { mode: "rename-folder"; folder: SavedSqlFolder }
  | { mode: "rename-file"; file: SavedSqlFile };

type DeleteTarget =
  | { kind: "folder"; item: SavedSqlFolder }
  | { kind: "file"; item: SavedSqlFile };

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
  const [dialog, setDialog] = useState<EditDialog | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
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

  const beginDialog = (next: EditDialog) => {
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
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] px-2">
        <Library size={14} className="text-sky-400" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold">SQL Library</div>
          <div className="truncate text-[9px] text-[hsl(var(--wb-text-muted))]">
            Private to {projectName}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Collapse all folders"
          disabled={folders.length === 0 || sortMode !== "folder"}
          onClick={() => setCollapsedFolderIds(new Set(folders.map((folder) => folder.id)))}
        >
          <ChevronsDownUp size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title={sortMode === "folder" ? "Sort by recent changes" : "Show folder tree"}
          onClick={() => setSortMode((current) => (current === "folder" ? "recent" : "folder"))}
        >
          <ArrowDownWideNarrow size={13} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Import or export SQL Library"
              disabled={isMutating}
            >
              <MoreHorizontal size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-[170px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[10px]">
            <DropdownMenuItem className="h-7 text-[10px]" onClick={() => void importDirectory()}>
              <Download size={11} className="mr-2" /> Import directory
            </DropdownMenuItem>
            <DropdownMenuItem className="h-7 text-[10px]" disabled={files.length === 0} onClick={() => void exportLibrary()}>
              <Upload size={11} className="mr-2" /> Export library
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Close SQL Library"
          onClick={() => setToolWindowVisible("sqlLibrary", false)}
        >
          <X size={13} />
        </Button>
      </div>

      <div className="shrink-0 space-y-1.5 border-b border-[hsl(var(--wb-border-subtle))] p-2">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[hsl(var(--wb-text-muted))]"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search saved SQL"
            aria-label="Search SQL Library"
            className="wb-field h-7 pl-7 pr-7 text-[10px]"
          />
          {search && (
            <button
              type="button"
              className="wb-icon-button absolute right-1 top-1 h-5 w-5"
              aria-label="Clear SQL Library search"
              onClick={() => setSearch("")}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 flex-1 justify-start gap-1.5 px-2 text-[10px]"
            onClick={() => beginDialog({ mode: "query", connectionId: activeConnectionId })}
          >
            <FilePlus2 size={12} /> New query
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 flex-1 justify-start gap-1.5 px-2 text-[10px]"
            onClick={() => beginDialog({ mode: "folder", connectionId: activeConnectionId })}
          >
            <FolderPlus size={12} /> New folder
          </Button>
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto py-1"
        role="tree"
        aria-label="SQL Library files"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void dropIntoFolder(event, null)}
      >
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-[10px] text-[hsl(var(--wb-text-muted))]">
            <LoaderCircle size={13} className="animate-spin" /> Loading SQL Library
          </div>
        ) : rows.length === 0 ? (
          <div className="mx-3 mt-6 rounded-[5px] border border-dashed border-[hsl(var(--wb-border))] p-4 text-center">
            <FileCode2 size={20} className="mx-auto mb-2 text-sky-400/70" />
            <div className="text-[11px] font-medium">
              {search ? "No saved SQL matches" : "Keep reusable SQL here"}
            </div>
            <div className="mt-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
              Library entries live in Oxide data. Project Files remain real files on disk.
            </div>
          </div>
        ) : (
          rows.map((row) =>
            row.kind === "folder" ? (
              <FolderRow
                key={row.folder.id}
                row={row}
                selected={selectedId === row.folder.id}
                collapsed={collapsedFolderIds.has(row.folder.id) && !search}
                scope={scopeLabel(row.folder.connectionId)}
                onSelect={() => setSelectedId(row.folder.id)}
                onToggle={() =>
                  setCollapsedFolderIds((current) => {
                    const next = new Set(current);
                    if (next.has(row.folder.id)) next.delete(row.folder.id);
                    else next.add(row.folder.id);
                    return next;
                  })
                }
                onNewQuery={() =>
                  beginDialog({
                    mode: "query",
                    folderId: row.folder.id,
                    connectionId: row.folder.connectionId,
                  })
                }
                onNewFolder={() =>
                  beginDialog({
                    mode: "folder",
                    parentFolderId: row.folder.id,
                    connectionId: row.folder.connectionId,
                  })
                }
                onRename={() => beginDialog({ mode: "rename-folder", folder: row.folder })}
                onDelete={() => setDeleteTarget({ kind: "folder", item: row.folder })}
                onDragStart={() => setDraggedFolderId(row.folder.id)}
                onDragEnd={() => setDraggedFolderId(null)}
                onDrop={(event) => void dropIntoFolder(event, row.folder.id)}
              />
            ) : (
              <FileRow
                key={row.file.id}
                row={row}
                selected={selectedId === row.file.id}
                scope={scopeLabel(row.file.connectionId)}
                onSelect={() => setSelectedId(row.file.id)}
                onOpen={() => void openSavedFile(row.file.id)}
                onRename={() => beginDialog({ mode: "rename-file", file: row.file })}
                onDelete={() => setDeleteTarget({ kind: "file", item: row.file })}
              />
            ),
          )
        )}
      </div>

      {(storeError || dialogError) && (
        <div className="shrink-0 border-t border-red-500/25 bg-red-500/10 px-2 py-1.5 text-[9px] leading-4 text-red-300">
          {dialogError || storeError}
        </div>
      )}

      <Dialog open={Boolean(dialog)} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
          <form onSubmit={(event) => void submitDialog(event)}>
            <DialogHeader>
              <DialogTitle className="text-[13px]">
                {dialog?.mode === "folder"
                  ? "Create folder"
                  : dialog?.mode === "query"
                    ? "Create saved query"
                    : "Rename SQL Library item"}
              </DialogTitle>
              <DialogDescription className="text-[10px] leading-5">
                This item is stored in the current project&apos;s private SQL Library, not on disk.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={dialogName}
              onChange={(event) => setDialogName(event.target.value)}
              className="wb-field mt-3"
              aria-label="SQL Library item name"
            />
            {dialogError && <div className="mt-2 text-[10px] text-red-300">{dialogError}</div>}
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="wb-primary-button" disabled={isMutating}>
                {dialog?.mode?.startsWith("rename") ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Delete {deleteTarget?.item.name}?</DialogTitle>
            <DialogDescription className="text-[10px] leading-5">
              {deleteTarget?.kind === "folder"
                ? "The folder, nested folders, and saved queries inside it will be permanently deleted."
                : "The saved query will be permanently deleted."}
            </DialogDescription>
          </DialogHeader>
          {dialogError && <div className="text-[10px] text-red-300">{dialogError}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={isMutating} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

function FolderRow(props: {
  row: Extract<SavedSqlTreeRow, { kind: "folder" }>;
  selected: boolean;
  collapsed: boolean;
  scope: string;
  onSelect: () => void;
  onToggle: () => void;
  onNewQuery: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent) => void;
}) {
  const { folder, depth } = props.row;
  const handleKey = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onToggle();
  };
  return (
    <div
      role="treeitem"
      aria-expanded={!props.collapsed}
      aria-selected={props.selected}
      tabIndex={0}
      draggable
      className={cn(
        "group flex h-6 items-center gap-1 pr-1 text-[10px] text-[hsl(var(--wb-text-muted))] outline-none hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-400/70",
        props.selected && "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]",
      )}
      style={{
        paddingLeft: `${6 + depth * 14}px`,
        contentVisibility: "auto",
        containIntrinsicSize: "24px",
      }}
      onClick={props.onSelect}
      onDoubleClick={props.onToggle}
      onKeyDown={handleKey}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", folder.id);
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(event) => event.preventDefault()}
      onDrop={props.onDrop}
      title={`${folder.name} · ${props.scope}`}
    >
      <button type="button" className="grid h-5 w-4 place-items-center" onClick={(event) => { event.stopPropagation(); props.onToggle(); }}>
        <ChevronRight size={11} className={cn("transition-transform", !props.collapsed && "rotate-90")} />
      </button>
      {props.collapsed ? <Folder size={12} className="text-amber-400" /> : <FolderOpen size={12} className="text-amber-400" />}
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      <span className="max-w-20 truncate text-[8px] opacity-0 group-hover:opacity-60">{props.scope}</span>
      <RowMenu onNewQuery={props.onNewQuery} onNewFolder={props.onNewFolder} onRename={props.onRename} onDelete={props.onDelete} />
    </div>
  );
}

function FileRow(props: {
  row: Extract<SavedSqlTreeRow, { kind: "file" }>;
  selected: boolean;
  scope: string;
  onSelect: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const { file, depth } = props.row;
  return (
    <div
      role="treeitem"
      aria-selected={props.selected}
      tabIndex={0}
      draggable
      className={cn(
        "group flex h-6 items-center gap-1.5 pr-1 text-[10px] text-[hsl(var(--wb-text-muted))] outline-none hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-400/70",
        props.selected && "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]",
      )}
      style={{
        paddingLeft: `${10 + depth * 14}px`,
        contentVisibility: "auto",
        containIntrinsicSize: "24px",
      }}
      onClick={props.onSelect}
      onDoubleClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        props.onOpen();
      }}
      onDragStart={(event) => writeSavedSqlDrag(event.dataTransfer, file.projectId, file.id)}
      title={`${file.name} · ${props.scope}${file.databaseName ? ` · ${file.databaseName}` : ""}`}
    >
      <FileCode2 size={12} className="shrink-0 text-sky-400" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      {(file.databaseName || file.connectionId) && (
        <span className="max-w-24 truncate text-[8px] opacity-55">
          {file.databaseName || props.scope}
        </span>
      )}
      <RowMenu onRename={props.onRename} onDelete={props.onDelete} onOpen={props.onOpen} />
    </div>
  );
}

function RowMenu(props: {
  onOpen?: () => void;
  onNewQuery?: () => void;
  onNewFolder?: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="wb-icon-button h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
          aria-label="SQL Library item actions"
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[150px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[10px]">
        {props.onOpen && <DropdownMenuItem className="h-7 text-[10px]" onClick={props.onOpen}>Open in editor</DropdownMenuItem>}
        {props.onNewQuery && <DropdownMenuItem className="h-7 text-[10px]" onClick={props.onNewQuery}>New query here</DropdownMenuItem>}
        {props.onNewFolder && <DropdownMenuItem className="h-7 text-[10px]" onClick={props.onNewFolder}>New subfolder</DropdownMenuItem>}
        <DropdownMenuItem className="h-7 text-[10px]" onClick={props.onRename}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-7 text-[10px] text-red-400 focus:text-red-300" onClick={props.onDelete}>
          <Trash2 size={11} className="mr-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
