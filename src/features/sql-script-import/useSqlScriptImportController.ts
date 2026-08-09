import { useCallback, useEffect, useRef, useState } from "react";
import { queryService } from "@/services/tauri";
import type {
  DatabaseDriver,
  SqlScriptImportPreview,
} from "@/services/tauri/types";
import { useTaskStore } from "@/store/useTaskStore";

export type SqlScriptImportTarget = {
  connectionId: string;
  schema?: string;
  database?: string;
  label: string;
  driver?: DatabaseDriver;
  contextKey?: string;
};

export type PendingSqlScriptImport = {
  target: SqlScriptImportTarget;
  filePath: string;
  preview: SqlScriptImportPreview;
  taskId: string;
};

type SqlScriptImportPhase = "preview" | "import" | "refresh";

type SqlScriptImportControllerOptions = {
  activeContextKey?: string | null;
  availabilityKey?: string | number;
  isTargetAvailable?: (target: SqlScriptImportTarget) => boolean;
  ensureTargetReady?: (target: SqlScriptImportTarget) => Promise<void>;
  refreshMetadata: (target: SqlScriptImportTarget) => Promise<void>;
  onError?: (
    message: string,
    phase: SqlScriptImportPhase,
    target: SqlScriptImportTarget,
  ) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Shared SQL script preflight/import workflow for the editor and database
 * explorer. The reviewed digest remains bound to the selected target, duplicate
 * submissions are rejected, and a post-import metadata failure is reported as
 * a separate introspection task so users are never encouraged to run a script
 * twice after it already committed successfully.
 */
export function useSqlScriptImportController({
  activeContextKey,
  availabilityKey,
  isTargetAvailable,
  ensureTargetReady,
  refreshMetadata,
  onError,
}: SqlScriptImportControllerOptions) {
  const [pendingImport, setPendingImport] =
    useState<PendingSqlScriptImport | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const mountedRef = useRef(false);
  const reviewingRef = useRef(false);
  const importingRef = useRef(false);
  const pendingRef = useRef<PendingSqlScriptImport | null>(null);
  const activeContextKeyRef = useRef(activeContextKey);
  const isTargetAvailableRef = useRef(isTargetAvailable);
  const ensureTargetReadyRef = useRef(ensureTargetReady);
  const refreshMetadataRef = useRef(refreshMetadata);
  const onErrorRef = useRef(onError);
  isTargetAvailableRef.current = isTargetAvailable;
  ensureTargetReadyRef.current = ensureTargetReady;
  refreshMetadataRef.current = refreshMetadata;
  onErrorRef.current = onError;
  pendingRef.current = pendingImport;
  activeContextKeyRef.current = activeContextKey;

  const targetIsAvailable = useCallback(
    (target: SqlScriptImportTarget) =>
      (!target.contextKey ||
        target.contextKey === activeContextKeyRef.current) &&
      isTargetAvailableRef.current?.(target) !== false,
    [],
  );

  const closeImport = useCallback((detail = "SQL script review cancelled") => {
    if (importingRef.current) return;
    const pending = pendingRef.current;
    if (pending) {
      useTaskStore.getState().cancelTask(pending.taskId, detail);
    }
    pendingRef.current = null;
    if (mountedRef.current) setPendingImport(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pending = pendingRef.current;
      if (pending && !importingRef.current) {
        useTaskStore
          .getState()
          .cancelTask(pending.taskId, "SQL script review closed");
      }
    };
  }, []);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || importingRef.current) return;
    if (!targetIsAvailable(pending.target)) {
      closeImport("SQL script target changed before approval");
    }
  }, [
    activeContextKey,
    availabilityKey,
    closeImport,
    targetIsAvailable,
  ]);

  const requestImport = useCallback(
    async (target: SqlScriptImportTarget) => {
      if (
        reviewingRef.current ||
        importingRef.current ||
        pendingRef.current ||
        !targetIsAvailable(target)
      ) {
        return;
      }
      reviewingRef.current = true;
      setIsReviewing(true);
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "SQL scripts", extensions: ["sql"] }],
        });
        if (typeof selected !== "string" || !targetIsAvailable(target)) return;

        const selectedFileName =
          selected.split(/[\\/]/).pop() || "SQL script";
        const tasks = useTaskStore.getState();
        const taskId = tasks.startTask({
          kind: "import",
          title: `Review ${selectedFileName}`,
          detail: target.label,
        });
        let preview: SqlScriptImportPreview;
        try {
          preview = await queryService.previewSqlScriptImport(
            target.connectionId,
            selected,
          );
        } catch (error) {
          const message = errorMessage(error);
          tasks.failTask(taskId, message, "SQL script review failed");
          onErrorRef.current?.(message, "preview", target);
          return;
        }

        if (!mountedRef.current || !targetIsAvailable(target)) {
          tasks.cancelTask(taskId, "SQL script target changed during review");
          return;
        }
        const pending = { target, filePath: selected, preview, taskId };
        pendingRef.current = pending;
        tasks.setTaskWaiting(taskId, "Awaiting SQL script review");
        setPendingImport(pending);
      } finally {
        reviewingRef.current = false;
        if (mountedRef.current) setIsReviewing(false);
      }
    },
    [targetIsAvailable],
  );

  const confirmImport = useCallback(async () => {
    const pending = pendingRef.current;
    if (
      !pending ||
      importingRef.current ||
      !targetIsAvailable(pending.target)
    ) {
      if (pending && !targetIsAvailable(pending.target)) {
        closeImport("SQL script target is no longer available");
      }
      return;
    }

    const tasks = useTaskStore.getState();
    importingRef.current = true;
    setIsImporting(true);
    tasks.setTaskRunning(pending.taskId, pending.target.label);
    tasks.updateTask(pending.taskId, {
      title: `Import ${pending.preview.fileName}`,
    });

    try {
      await ensureTargetReadyRef.current?.(pending.target);
      const imported = await queryService.importSqlScript(
        pending.target.connectionId,
        pending.filePath,
        pending.preview.reviewDigest,
        pending.target.schema,
        pending.target.database,
      );
      tasks.finishTask(
        pending.taskId,
        `${imported.statementsExecuted.toLocaleString()} statements · ${imported.rowsAffected.toLocaleString()} rows affected`,
      );
      pendingRef.current = null;
      if (mountedRef.current) setPendingImport(null);

      try {
        await refreshMetadataRef.current(pending.target);
      } catch (error) {
        const message = errorMessage(error);
        const refreshTaskId = tasks.startTask({
          kind: "introspection",
          title: `Refresh metadata after ${pending.preview.fileName}`,
          detail: pending.target.label,
        });
        tasks.failTask(
          refreshTaskId,
          message,
          "SQL import completed; metadata refresh failed",
        );
        onErrorRef.current?.(message, "refresh", pending.target);
      }
    } catch (error) {
      const message = errorMessage(error);
      tasks.failTask(pending.taskId, message);
      onErrorRef.current?.(message, "import", pending.target);
    } finally {
      importingRef.current = false;
      if (mountedRef.current) setIsImporting(false);
    }
  }, [closeImport, targetIsAvailable]);

  return {
    pendingImport,
    isReviewing,
    isImporting,
    requestImport,
    confirmImport,
    closeImport,
  };
}
