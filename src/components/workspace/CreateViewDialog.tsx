import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { databaseService, tableService } from "@/services/tauri";
import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { invalidateTableMetadata } from "@/services/tableMetadataCache";

interface CreateViewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  driver: DatabaseDriver;
  schema: string;
  mode?: "create" | "edit";
  viewKind?: "view" | "materializedView";
  initialViewName?: string;
  initialSelectSql?: string;
}

export function CreateViewDialog({
  isOpen,
  onClose,
  connectionId,
  driver,
  schema,
  mode = "create",
  viewKind = "view",
  initialViewName = "",
  initialSelectSql = "",
}: CreateViewDialogProps) {
  const [viewName, setViewName] = useState("");
  const [selectSql, setSelectSql] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [withData, setWithData] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<DatabaseCapabilities>(
    defaultDatabaseCapabilities(driver)
  );

  const { loadTables, bumpMetadataVersion } = useSchemaStore();
  const connection = useConnectionStore((state) =>
    state.connections.find((item) => item.id === connectionId),
  );
  const activeCapabilities =
    capabilities.driver === driver
      ? capabilities
      : defaultDatabaseCapabilities(driver);
  const isEditMode = mode === "edit";
  const isMaterializedView = viewKind === "materializedView";
  const objectLabel = isMaterializedView ? "Materialized View" : "View";

  useEffect(() => {
    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(driver);
    setCapabilities(fallback);

    databaseService
      .getDatabaseCapabilities(driver, connection?.driverPackageVersion)
      .then((nextCapabilities) => {
        if (!cancelled) setCapabilities(nextCapabilities);
      })
      .catch((err) => {
        console.error("Failed to load database capabilities:", err);
        if (!cancelled) setCapabilities(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [connection?.driverPackageVersion, driver]);

  useEffect(() => {
    if (!isOpen) return;
    setViewName(initialViewName);
    setSelectSql(initialSelectSql);
    setReplaceExisting(false);
    setWithData(true);
    setError(null);
  }, [initialSelectSql, initialViewName, isOpen]);

  const resetForm = () => {
    setViewName("");
    setSelectSql("");
    setReplaceExisting(false);
    setWithData(true);
    setError(null);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    resetForm();
    onClose();
  };

  const handleCreate = async () => {
    if (!viewName.trim()) {
      setError("View name is required");
      return;
    }
    if (!selectSql.trim()) {
      setError("View query is required");
      return;
    }
    if (isMaterializedView && !activeCapabilities.supportsMaterializedViews) {
      setError(`${activeCapabilities.displayName} does not support materialized views`);
      return;
    }
    if (!isMaterializedView && !activeCapabilities.supportsViews) {
      setError(`${activeCapabilities.displayName} does not support views`);
      return;
    }
    if (
      !isMaterializedView &&
      (isEditMode || replaceExisting) &&
      !activeCapabilities.supportsReplaceView
    ) {
      setError(`${activeCapabilities.displayName} does not support replacing views`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (isMaterializedView) {
        await tableService.createMaterializedView(
          connectionId,
          driver,
          schema,
          viewName,
          selectSql,
          withData
        );
      } else {
        await tableService.createView(
          connectionId,
          driver,
          schema,
          viewName,
          selectSql,
          isEditMode || replaceExisting
        );
      }
      await invalidateTableMetadata({
        connectionId,
        driver,
        schema,
        table: viewName,
      });
      await loadTables(connectionId, schema, true);
      bumpMetadataVersion();
      resetForm();
      onClose();
    } catch (e: any) {
      setError(e.toString());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="max-w-[640px] bg-[#18181b] text-foreground border-white/10">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? `Edit ${objectLabel}` : `Create New ${objectLabel}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-xs p-2 rounded border border-destructive/20">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              View Name
            </label>
            <Input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="e.g. active_users"
              className="bg-[#27272a] border-white/10"
              autoFocus
              disabled={isEditMode}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Query
            </label>
            <textarea
              value={selectSql}
              onChange={(e) => setSelectSql(e.target.value)}
              placeholder="SELECT id, email FROM users WHERE active = true"
              className="min-h-[180px] w-full resize-y rounded-sm border border-white/10 bg-[#27272a] px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
              spellCheck={false}
            />
          </div>

          {!isEditMode &&
            !isMaterializedView &&
            activeCapabilities.supportsReplaceView && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={replaceExisting}
                onCheckedChange={(checked) => setReplaceExisting(!!checked)}
              />
              Replace existing view
            </label>
            )}
          {!isEditMode && isMaterializedView && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={withData}
                onCheckedChange={(checked) => setWithData(!!checked)}
              />
              Populate data immediately
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting
              ? isEditMode
                ? "Saving..."
                : "Creating..."
              : isEditMode
              ? `Save ${objectLabel}`
              : `Create ${objectLabel}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
