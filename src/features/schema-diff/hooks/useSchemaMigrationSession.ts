import { schemaService } from "@/services/tauri/schema.service";
import type { SchemaMigrationJournalEntry } from "@/services/tauri/types";
import type { SchemaDiffPlan } from "@/services/tauri/types/schemaDiff";
import { useEffect, useMemo, useState } from "react";

interface UseSchemaMigrationSessionContext {
  plan: SchemaDiffPlan | undefined;
  activeProjectId: string;
}

export function useSchemaMigrationSession({
  plan,
  activeProjectId,
}: UseSchemaMigrationSessionContext) {
  const [copied, setCopied] = useState(false);
  const [previewSurface, setPreviewSurface] = useState<
    "migration" | "preflight" | "rollback" | "run"
  >("migration");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [confirmationTarget, setConfirmationTarget] = useState("");
  const [allowReview, setAllowReview] = useState(false);
  const [allowDestructive, setAllowDestructive] = useState(false);
  const [allowNonTransactional, setAllowNonTransactional] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isRecapturing, setIsRecapturing] = useState(false);
  const [execution, setExecution] =
    useState<SchemaMigrationJournalEntry | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [recentExecutions, setRecentExecutions] = useState<
    SchemaMigrationJournalEntry[]
  >([]);
  const previewSql =
    previewSurface === "migration"
      ? plan?.migrationSql || ""
      : previewSurface === "preflight"
        ? plan?.preflightSql || ""
        : previewSurface === "rollback"
          ? execution?.rollback.sql || recentExecutions[0]?.rollback.sql || ""
          : "";
  const sqlLines = useMemo(() => previewSql.split("\n"), [previewSql]);

  useEffect(() => {
    if (!plan) return;
    let active = true;
    void schemaService
      .listSchemaMigrationJournal(activeProjectId, plan.targetConnectionId, 12)
      .then((entries) => {
        if (active) setRecentExecutions(entries);
      })
      .catch(() => {
        if (active) setRecentExecutions([]);
      });
    return () => {
      active = false;
    };
  }, [activeProjectId, plan?.id, plan?.targetConnectionId]);

  useEffect(() => {
    setConfirmationOpen(false);
    setConfirmationTarget("");
    setAllowReview(false);
    setAllowDestructive(false);
    setAllowNonTransactional(false);
    setExecution(null);
    setExecutionError(null);
    setPreviewSurface("migration");
  }, [plan?.id]);

  return {
    copied,
    setCopied,
    previewSurface,
    setPreviewSurface,
    confirmationOpen,
    setConfirmationOpen,
    confirmationTarget,
    setConfirmationTarget,
    allowReview,
    setAllowReview,
    allowDestructive,
    setAllowDestructive,
    allowNonTransactional,
    setAllowNonTransactional,
    isApplying,
    setIsApplying,
    isRecapturing,
    setIsRecapturing,
    execution,
    setExecution,
    executionError,
    setExecutionError,
    recentExecutions,
    setRecentExecutions,
    previewSql,
    sqlLines,
  };
}
