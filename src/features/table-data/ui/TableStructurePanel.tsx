import { Button } from "@/components/ui/button";
import { mongodbIndexPresentation } from "@/lib/mongodbIndexPresentation";
import { Pencil, Plus, Trash2 } from "lucide-react";

const formatColumnList = (columns: string[]) =>
  columns.length > 0 ? columns.join(", ") : "-";

const renderMetadataRow = (
  key: string,
  label: string,
  value: string,
  detail?: string | null,
) => (
  <div
    key={key}
    className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
    title={detail || value}
  >
    <span className="w-24 shrink-0 truncate text-muted-foreground">
      {label}
    </span>
    <span className="min-w-0 flex-1 truncate text-foreground">{value}</span>
  </div>
);

interface TableStructurePanelContext {
  metadataColumns: import("@/services/tauri/types").ColumnInfo[];
  setIsIndexDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  canManageIndexes: boolean;
  isCrossDatabasePreview: boolean;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  tableIndexes: import("@/services/tauri/types").IndexInfo[];
  isMongoDocumentPreview: boolean;
  handleRenameIndex: (
    index: import("@/services/tauri/types").IndexInfo,
  ) => Promise<void>;
  handleDropIndex: (
    index: import("@/services/tauri/types").IndexInfo,
  ) => Promise<void>;
  setIsConstraintDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  canManageConstraints: boolean | undefined;
  tableConstraints: import("@/services/tauri/types").ConstraintInfo[];
  handleDropConstraint: (
    constraint: import("@/services/tauri/types").ConstraintInfo,
  ) => Promise<void>;
}

export function TableStructurePanel({
  metadataColumns,
  setIsIndexDialogOpen,
  canManageIndexes,
  isCrossDatabasePreview,
  activeCapabilities,
  tableIndexes,
  isMongoDocumentPreview,
  handleRenameIndex,
  handleDropIndex,
  setIsConstraintDialogOpen,
  canManageConstraints,
  tableConstraints,
  handleDropConstraint,
}: TableStructurePanelContext) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 gap-5 overflow-auto bg-[hsl(var(--wb-panel))] px-4 py-3 text-xs">
      <div className="min-w-0">
        <div className="mb-1 font-medium text-foreground">Columns</div>
        {metadataColumns.length === 0 ? (
          <div className="text-muted-foreground">No columns loaded</div>
        ) : (
          metadataColumns.map((column) =>
            renderMetadataRow(
              `column:${column.name}`,
              column.name,
              column.data_type,
              [
                column.is_primary_key ? "primary key" : null,
                column.is_unique ? "unique" : null,
                column.is_indexed ? "indexed" : null,
                column.is_nullable ? "nullable" : "not null",
              ]
                .filter(Boolean)
                .join(", "),
            ),
          )
        )}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="font-medium text-foreground">Indexes</div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsIndexDialogOpen(true)}
            disabled={!canManageIndexes}
            title={
              isCrossDatabasePreview
                ? "Index changes are unavailable for a table opened from another database"
                : activeCapabilities.supportsTableIndexes
                  ? "Create index"
                  : "Indexes are not supported by this driver"
            }
          >
            <Plus size={12} />
          </Button>
        </div>
        {tableIndexes.length === 0 ? (
          <div className="text-muted-foreground">No indexes loaded</div>
        ) : (
          tableIndexes.map((index) => {
            const mongoPresentation = isMongoDocumentPreview
              ? mongodbIndexPresentation(index)
              : null;
            const mongoHints = mongoPresentation
              ? [
                  mongoPresentation.expireAfterSeconds !== null
                    ? `TTL ${mongoPresentation.expireAfterSeconds}s`
                    : null,
                  mongoPresentation.isSparse ? "sparse" : null,
                  mongoPresentation.isHidden ? "hidden" : null,
                  mongoPresentation.hasPartialFilter ? "partial" : null,
                ].filter((hint): hint is string => Boolean(hint))
              : [];
            return (
              <div
                key={`index:${index.name}`}
                className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
                title={[
                  index.is_primary ? "primary" : null,
                  index.is_unique ? "unique" : null,
                  index.index_type || null,
                  ...mongoHints,
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                <span className="w-24 shrink-0 truncate text-muted-foreground">
                  {index.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {formatColumnList(index.columns)}
                </span>
                {mongoHints.length > 0 && (
                  <span className="max-w-28 shrink truncate rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">
                    {mongoHints.join(" · ")}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={
                    !canManageIndexes ||
                    index.is_primary ||
                    !activeCapabilities.supportsIndexRename
                  }
                  onClick={() => void handleRenameIndex(index)}
                  title={
                    !canManageIndexes
                      ? "Index changes are not available for this object"
                      : index.is_primary
                        ? "Primary indexes are managed through constraints"
                        : !activeCapabilities.supportsIndexRename
                          ? "This driver requires recreating indexes to rename"
                          : "Rename index"
                  }
                >
                  <Pencil size={12} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={!canManageIndexes || index.is_primary}
                  onClick={() => void handleDropIndex(index)}
                  title={
                    !canManageIndexes
                      ? "Index changes are not available for this object"
                      : index.is_primary
                        ? "Primary indexes are managed through constraints"
                        : "Drop index"
                  }
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            );
          })
        )}
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="font-medium text-foreground">Constraints</div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setIsConstraintDialogOpen(true)}
            disabled={!canManageConstraints}
            title={
              isCrossDatabasePreview
                ? "Constraint changes are unavailable for a table opened from another database"
                : activeCapabilities.supportsTableConstraints
                  ? "Create constraint"
                  : "Constraints are not supported by this driver"
            }
          >
            <Plus size={12} />
          </Button>
        </div>
        {tableConstraints.length === 0 ? (
          <div className="text-muted-foreground">No constraints loaded</div>
        ) : (
          tableConstraints.map((constraint) => {
            const reference =
              constraint.referenced_table &&
              `${constraint.referenced_schema || ""}${
                constraint.referenced_schema ? "." : ""
              }${constraint.referenced_table}(${formatColumnList(
                constraint.referenced_columns,
              )})`;
            const isPrimary =
              constraint.constraint_type.toUpperCase() === "PRIMARY KEY";
            return (
              <div
                key={`constraint:${constraint.name}`}
                className="flex min-w-0 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0"
                title={
                  reference ||
                  constraint.definition ||
                  formatColumnList(constraint.columns)
                }
              >
                <span className="w-24 shrink-0 truncate text-muted-foreground">
                  {constraint.name}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {constraint.constraint_type}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={!canManageConstraints}
                  onClick={() => void handleDropConstraint(constraint)}
                  title={
                    !canManageConstraints
                      ? "Constraint changes are not available for this object"
                      : isPrimary
                        ? "Drop primary key"
                        : "Drop constraint"
                  }
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
