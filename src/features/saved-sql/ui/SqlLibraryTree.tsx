import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { writeSavedSqlDrag } from "@/lib/savedSqlDrag";
import type { SavedSqlTreeRow } from "@/lib/savedSqlLibrary";
import type {
  SavedSqlFile,
  SavedSqlFolder,
} from "@/services/tauri/saved-sql.service";
import {
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";

interface SqlLibraryTreeProps {
  isLoading: boolean;
  rows: readonly SavedSqlTreeRow[];
  search: string;
  selectedId: string | null;
  collapsedFolderIds: ReadonlySet<string>;
  scopeLabel: (connectionId?: string | null) => string;
  onRootDrop: (event: DragEvent) => void;
  onFolderDrop: (event: DragEvent, folderId: string) => void;
  onSelect: (id: string) => void;
  onToggleFolder: (folder: SavedSqlFolder) => void;
  onCreateQuery: (folder: SavedSqlFolder) => void;
  onCreateFolder: (parentFolder: SavedSqlFolder) => void;
  onRenameFolder: (folder: SavedSqlFolder) => void;
  onDeleteFolder: (folder: SavedSqlFolder) => void;
  onFolderDragStart: (folder: SavedSqlFolder) => void;
  onFolderDragEnd: () => void;
  onOpenFile: (file: SavedSqlFile) => void;
  onRenameFile: (file: SavedSqlFile) => void;
  onDeleteFile: (file: SavedSqlFile) => void;
}

export function SqlLibraryTree({
  isLoading,
  rows,
  search,
  selectedId,
  collapsedFolderIds,
  scopeLabel,
  onRootDrop,
  onFolderDrop,
  onSelect,
  onToggleFolder,
  onCreateQuery,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onFolderDragStart,
  onFolderDragEnd,
  onOpenFile,
  onRenameFile,
  onDeleteFile,
}: SqlLibraryTreeProps) {
  return (
    <div
      className="min-h-0 flex-1 overflow-auto py-1"
      role="tree"
      aria-label="SQL Library files"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onRootDrop}
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
              onSelect={() => onSelect(row.folder.id)}
              onToggle={() => onToggleFolder(row.folder)}
              onNewQuery={() => onCreateQuery(row.folder)}
              onNewFolder={() => onCreateFolder(row.folder)}
              onRename={() => onRenameFolder(row.folder)}
              onDelete={() => onDeleteFolder(row.folder)}
              onDragStart={() => onFolderDragStart(row.folder)}
              onDragEnd={onFolderDragEnd}
              onDrop={(event) => onFolderDrop(event, row.folder.id)}
            />
          ) : (
            <FileRow
              key={row.file.id}
              row={row}
              selected={selectedId === row.file.id}
              scope={scopeLabel(row.file.connectionId)}
              onSelect={() => onSelect(row.file.id)}
              onOpen={() => onOpenFile(row.file)}
              onRename={() => onRenameFile(row.file)}
              onDelete={() => onDeleteFile(row.file)}
            />
          ),
        )
      )}
    </div>
  );
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
      <DropdownMenuContent className="min-w-[150px] p-1 text-[10px]">
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
