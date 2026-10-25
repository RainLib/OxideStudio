import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ProjectFileTreeNode } from "@/store/useProjectFilesStore";
import { supportsProjectFilePreview } from "@/services/tauri/project-files.service";
import { fileQueryFormat } from "@/features/file-query/model";
import { useI18n } from "@/i18n";
import {
  ChevronDown, ChevronRight, FileCode2, FileText, Folder, FolderOpen,
  Image as ImageIcon, LoaderCircle, MoreHorizontal, Trash2,
} from "lucide-react";

function isSqlFile(name: string) {
  return /\.(sql|psql|mysql|pgsql)$/i.test(name);
}

interface ProjectFileNodeProps {
  node: ProjectFileTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (node: ProjectFileTreeNode) => void;
  onOpen: (node: ProjectFileTreeNode) => void;
  onRename: (node: ProjectFileTreeNode) => void;
  onDelete: (node: ProjectFileTreeNode) => void;
  onQuery?: (node: ProjectFileTreeNode) => void;
  onOpenText?: (node: ProjectFileTreeNode) => void;
  disabled?: boolean;
}

export function ProjectFileNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onOpen,
  onRename,
  onDelete,
  onQuery,
  onOpenText,
  disabled = false,
}: ProjectFileNodeProps) {
  const { t } = useI18n();
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
            className="min-w-[150px] p-1 text-[11px]"
          >
            {!isDirectory && fileQueryFormat(node.name) && onQuery && <DropdownMenuItem className="h-7 text-[11px]" disabled={disabled || node.isSymlink} onClick={() => onQuery(node)}>{t("fileQuery.queryFile")}</DropdownMenuItem>}
            {!isDirectory && fileQueryFormat(node.name) !== "parquet" && onOpenText && <DropdownMenuItem className="h-7 text-[11px]" disabled={disabled || node.isSymlink} onClick={() => onOpenText(node)}>{t("fileQuery.openText")}</DropdownMenuItem>}
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
            onQuery={onQuery}
            onOpenText={onOpenText}
            disabled={disabled}
          />
        ))}
    </>
  );
}
