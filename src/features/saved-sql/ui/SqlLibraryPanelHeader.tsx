import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SqlLibrarySortMode } from "@/features/saved-sql/ui/sqlLibraryPanelTypes";
import {
  ArrowDownWideNarrow,
  ChevronsDownUp,
  Download,
  FilePlus2,
  FolderPlus,
  Library,
  MoreHorizontal,
  Search,
  Upload,
  X,
} from "lucide-react";

interface SqlLibraryPanelHeaderProps {
  projectName: string;
  search: string;
  sortMode: SqlLibrarySortMode;
  hasFolders: boolean;
  hasFiles: boolean;
  isMutating: boolean;
  onSearchChange: (search: string) => void;
  onSortModeToggle: () => void;
  onCollapseAll: () => void;
  onImport: () => void;
  onExport: () => void;
  onCreateQuery: () => void;
  onCreateFolder: () => void;
  onClose: () => void;
}

export function SqlLibraryPanelHeader({
  projectName,
  search,
  sortMode,
  hasFolders,
  hasFiles,
  isMutating,
  onSearchChange,
  onSortModeToggle,
  onCollapseAll,
  onImport,
  onExport,
  onCreateQuery,
  onCreateFolder,
  onClose,
}: SqlLibraryPanelHeaderProps) {
  return (
    <>
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
          disabled={!hasFolders || sortMode !== "folder"}
          onClick={onCollapseAll}
        >
          <ChevronsDownUp size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title={sortMode === "folder" ? "Sort by recent changes" : "Show folder tree"}
          onClick={onSortModeToggle}
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
            <DropdownMenuItem className="h-7 text-[10px]" onClick={onImport}>
              <Download size={11} className="mr-2" /> Import directory
            </DropdownMenuItem>
            <DropdownMenuItem className="h-7 text-[10px]" disabled={!hasFiles} onClick={onExport}>
              <Upload size={11} className="mr-2" /> Export library
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          title="Close SQL Library"
          onClick={onClose}
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
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search saved SQL"
            aria-label="Search SQL Library"
            className="wb-field h-7 pl-7 pr-7 text-[10px]"
          />
          {search && (
            <button
              type="button"
              className="wb-icon-button absolute right-1 top-1 h-5 w-5"
              aria-label="Clear SQL Library search"
              onClick={() => onSearchChange("")}
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
            onClick={onCreateQuery}
          >
            <FilePlus2 size={12} /> New query
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 flex-1 justify-start gap-1.5 px-2 text-[10px]"
            onClick={onCreateFolder}
          >
            <FolderPlus size={12} /> New folder
          </Button>
        </div>
      </div>
    </>
  );
}
