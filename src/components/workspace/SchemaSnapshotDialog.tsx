import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Database,
  FileCode2,
  GitCompareArrows,
  Loader2,
  Network,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  captureAndSaveSchemaSnapshot,
  compareSnapshotToLive,
  deleteSchemaSnapshot,
  listSchemaSnapshots,
  saveSchemaSnapshot,
  type SchemaSnapshotIdentity,
} from "@/services/schemaSnapshotStore";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { projectFilesService } from "@/services/tauri";
import { cn } from "@/lib/utils";
import { useTabStore } from "@/store/useTabStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useProjectStore } from "@/store/useProjectStore";
import {
  createProjectDdlSnapshot,
  isProjectDdlSnapshot,
  projectDdlSnapshotSources,
} from "@/features/schema-diff/model/projectDdlSnapshot";
import {
  createSchemaDbmlSnapshot,
  isSchemaDbmlSnapshot,
} from "@/features/schema-diff/model/schemaDbmlImport";
import {
  createChartDbMetadataSnapshot,
  isChartDbMetadataSnapshot,
} from "@/features/schema-diff/model/chartDbMetadataImport";

interface SchemaSnapshotDialogProps {
  open: boolean;
  identity: SchemaSnapshotIdentity | null;
  onClose: () => void;
}

const ALL_PROJECT_DDL_SOURCES = "__oxide_all_project_sql__";

export function SchemaSnapshotDialog({
  open,
  identity,
  onClose,
}: SchemaSnapshotDialogProps) {
  const [snapshots, setSnapshots] = useState<SchemaSnapshot[]>([]);
  const [projectDdlDocuments, setProjectDdlDocuments] = useState<
    Array<{ relativePath: string; content: string }>
  >([]);
  const [selectedProjectDdlPath, setSelectedProjectDdlPath] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [operation, setOperation] = useState<
    "capture" | "compare" | "import" | null
  >(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dbmlInputRef = useRef<HTMLInputElement>(null);
  const metadataInputRef = useRef<HTMLInputElement>(null);
  const openSchemaDiffTab = useTabStore((state) => state.openSchemaDiffTab);
  const openSchemaDiagramTab = useTabStore(
    (state) => state.openSchemaDiagramTab,
  );
  const activeProjectRoot = useProjectStore(
    (state) =>
      state.projects.find((project) => project.id === state.activeProjectId)
        ?.root_path || null,
  );
  const { startTask, finishTask, failTask } = useTaskStore();
  const supportsRestorePlan =
    identity?.driver === "postgres" || identity?.driver === "mysql";
  const supportsSchemaReviewPlan = supportsRestorePlan || identity?.driver === "sqlite";
  const objectLabel = supportsSchemaReviewPlan ? "relations" : "objects";
  const selected = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedId) || null,
    [selectedId, snapshots],
  );
  const selectedIsProjectDdl = Boolean(selected && isProjectDdlSnapshot(selected));
  const selectedIsDbml = Boolean(selected && isSchemaDbmlSnapshot(selected));
  const selectedIsMetadata = Boolean(
    selected && isChartDbMetadataSnapshot(selected),
  );
  const selectedIsOffline =
    selectedIsProjectDdl || selectedIsDbml || selectedIsMetadata;
  const selectedProjectDdlSources = useMemo(
    () => (selected && isProjectDdlSnapshot(selected)
      ? projectDdlSnapshotSources(selected)
      : []),
    [selected],
  );
  const selectedSupportsRestorePlan = supportsSchemaReviewPlan && !selectedIsOffline;

  useEffect(() => {
    if (!open || !identity) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPendingDeleteId(null);
    void listSchemaSnapshots(identity)
      .then((nextSnapshots) => {
        if (cancelled) return;
        setSnapshots(nextSnapshots);
        setSelectedId(nextSnapshots[0]?.id || null);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, open]);

  useEffect(() => {
    if (!open || !identity || !activeProjectRoot) {
      setProjectDdlDocuments([]);
      setSelectedProjectDdlPath("");
      return;
    }
    let cancelled = false;
    void projectFilesService
      .getLspDocuments({
        projectId: identity.projectId,
        expectedRoot: activeProjectRoot,
      })
      .then((documents) => {
        if (cancelled) return;
        setProjectDdlDocuments(documents);
        setSelectedProjectDdlPath((current) =>
          current === ALL_PROJECT_DDL_SOURCES ||
          documents.some((document) => document.relativePath === current)
            ? current
            : documents.length > 0
              ? ALL_PROJECT_DDL_SOURCES
              : "",
        );
      })
      .catch(() => {
        if (!cancelled) {
          setProjectDdlDocuments([]);
          setSelectedProjectDdlPath("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectRoot, identity, open]);

  if (!identity) return null;

  const capture = async () => {
    if (operation) return;
    const taskId = startTask({
      kind: "introspection",
      title: `Snapshot ${identity.schemaName}`,
      detail: identity.connectionName,
    });
    setOperation("capture");
    setError(null);
    try {
      const snapshot = await captureAndSaveSchemaSnapshot(identity);
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setSelectedId(snapshot.id);
      finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} ${objectLabel} captured`,
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
    }
  };

  const importProjectDdl = async () => {
    if (operation || !selectedProjectDdlPath) return;
    const documents = selectedProjectDdlPath === ALL_PROJECT_DDL_SOURCES
      ? [...projectDdlDocuments].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      )
      : projectDdlDocuments.filter(
        (candidate) => candidate.relativePath === selectedProjectDdlPath,
      );
    if (documents.length === 0) return;
    const sourceLabel = documents.length === 1
      ? documents[0]!.relativePath
      : `${documents.length} project SQL files`;
    const taskId = startTask({
      kind: "introspection",
      title: `Parse project DDL`,
      detail: sourceLabel,
    });
    setOperation("import");
    setError(null);
    try {
      const snapshot = createProjectDdlSnapshot(
        identity,
        documents.map((document) => document.relativePath),
        documents
          .map((document) => `-- ${document.relativePath}\n${document.content}`)
          .join("\n\n"),
      );
      await saveSchemaSnapshot(snapshot);
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setSelectedId(snapshot.id);
      finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} relations parsed for review`,
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
    }
  };

  const importDbml = async (file: File | undefined) => {
    if (!file || operation) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("DBML review import is limited to 8 MiB per file.");
      if (dbmlInputRef.current) dbmlInputRef.current.value = "";
      return;
    }
    const taskId = startTask({
      kind: "introspection",
      title: "Parse DBML baseline",
      detail: file.name,
    });
    setOperation("import");
    setError(null);
    try {
      const snapshot = createSchemaDbmlSnapshot(identity, file.name, await file.text());
      if (snapshot.relations.length === 0) {
        throw new Error("No supported DBML Table block was found.");
      }
      await saveSchemaSnapshot(snapshot);
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setSelectedId(snapshot.id);
      finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} DBML relations parsed for review`,
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      if (dbmlInputRef.current) dbmlInputRef.current.value = "";
    }
  };

  const importMetadataJson = async (file: File | undefined) => {
    if (!file || operation) return;
    if (file.size > 16 * 1024 * 1024) {
      setError("Metadata JSON review import is limited to 16 MiB per file.");
      if (metadataInputRef.current) metadataInputRef.current.value = "";
      return;
    }
    const taskId = startTask({
      kind: "introspection",
      title: "Parse metadata JSON baseline",
      detail: file.name,
    });
    setOperation("import");
    setError(null);
    try {
      const snapshot = createChartDbMetadataSnapshot(
        identity,
        file.name,
        await file.text(),
      );
      if (snapshot.relations.length === 0) {
        throw new Error("No target-schema relation metadata was found.");
      }
      await saveSchemaSnapshot(snapshot);
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setSelectedId(snapshot.id);
      finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} metadata relations parsed for review`,
      );
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      if (metadataInputRef.current) metadataInputRef.current.value = "";
    }
  };

  const compare = async () => {
    if (!selected || operation) return;
    const taskId = startTask({
      kind: "introspection",
      title: `Compare ${identity.schemaName}`,
      detail: "Snapshot → live target",
    });
    setOperation("compare");
    setError(null);
    try {
      const { target, plan } = await compareSnapshotToLive(selected, identity);
      openSchemaDiffTab(plan, selected, target);
      finishTask(
        taskId,
        `${plan.summary.total.toLocaleString()} schema changes found`,
      );
      onClose();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
    }
  };

  const remove = async (snapshot: SchemaSnapshot) => {
    if (operation || deletingId) return;
    if (pendingDeleteId !== snapshot.id) {
      setPendingDeleteId(snapshot.id);
      return;
    }
    setDeletingId(snapshot.id);
    setError(null);
    try {
      await deleteSchemaSnapshot(snapshot);
      const remaining = snapshots.filter((candidate) => candidate.id !== snapshot.id);
      setSnapshots(remaining);
      if (selectedId === snapshot.id) {
        setSelectedId(remaining[0]?.id || null);
      }
      setPendingDeleteId(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setDeletingId(null);
    }
  };

  const busy = Boolean(operation || deletingId);

  const openDiagram = () => {
    if (!selected || busy) return;
    openSchemaDiagramTab(selected);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !busy && onClose()}>
      <DialogContent className="h-[min(620px,calc(100vh-32px))] w-[min(820px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <GitCompareArrows size={15} />
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">
                {supportsSchemaReviewPlan ? "Schema" : "Metadata"} snapshots · {identity.schemaName}
              </DialogTitle>
              <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                {identity.connectionName}
                {identity.databaseName ? ` · ${identity.databaseName}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[310px_minmax(0,1fr)]">
          <section className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] px-3 text-[10px]">
              <span className="font-medium">Saved baselines</span>
              <span className="wb-muted">{snapshots.length} versions</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[10px] wb-muted">
                  <Loader2 size={13} className="animate-spin" /> Loading snapshots
                </div>
              ) : snapshots.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <Camera size={22} className="mb-2 wb-muted" />
                  <div className="text-[11px] font-medium">No baseline yet</div>
                  <div className="mt-1 text-[9px] leading-4 wb-muted">
                    Capture the current live structure, then compare future drift against it.
                  </div>
                </div>
              ) : (
                snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className={cn(
                      "mb-1 flex w-full items-stretch overflow-hidden rounded-[4px] border transition-colors",
                      selectedId === snapshot.id
                        ? "border-[hsl(var(--wb-accent)/0.48)] bg-[hsl(var(--wb-active-strong))]"
                        : "border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.42)] hover:bg-[hsl(var(--wb-hover))]",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 px-2.5 py-2 text-left"
                      onClick={() => {
                        setSelectedId(snapshot.id);
                        setPendingDeleteId(null);
                      }}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-medium">
                          {formatTimestamp(snapshot.capturedAt)}
                        </span>
                        <span className="font-mono text-[8px] wb-muted">
                          {snapshot.fingerprint.slice(0, 8)}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[9px] wb-muted">
                        <Database size={9} />
                        {snapshot.relations.length.toLocaleString()} {objectLabel}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "flex w-11 shrink-0 items-center justify-center border-l border-[hsl(var(--wb-border-subtle))] text-[8px] transition-colors",
                        pendingDeleteId === snapshot.id
                          ? "bg-red-400/10 text-red-300"
                          : "wb-muted hover:bg-red-400/10 hover:text-red-300",
                      )}
                      aria-label={
                        pendingDeleteId === snapshot.id
                          ? "Confirm delete schema snapshot"
                          : "Delete schema snapshot"
                      }
                      title={
                        pendingDeleteId === snapshot.id
                          ? "Click again to delete"
                          : "Delete snapshot"
                      }
                      disabled={busy}
                      onClick={() => void remove(snapshot)}
                    >
                      {deletingId === snapshot.id ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : pendingDeleteId === snapshot.id ? (
                        "Delete"
                      ) : (
                        <Trash2 size={11} />
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col bg-[hsl(var(--wb-editor))] p-4">
            <div className="text-[11px] font-medium">Comparison direction</div>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)] items-center gap-2">
              <TargetCard
                eyebrow="Desired source"
                title={selected ? `Snapshot ${formatTimestamp(selected.capturedAt)}` : "Select a snapshot"}
                detail={selected ? selected.fingerprint.slice(0, 12) : "No baseline selected"}
              />
              <div className="text-center text-[16px] text-[hsl(var(--wb-accent))]">→</div>
              <TargetCard
                eyebrow="Actual target"
                title="Fresh live capture"
                detail={`${identity.connectionName} / ${identity.schemaName}`}
              />
            </div>

            <div className="mt-4 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.4)] p-3 text-[9px] leading-4 wb-muted">
              {selectedIsOffline
                ? `This baseline is inferred from bounded ${selectedIsDbml ? "DBML" : selectedIsMetadata ? "metadata JSON" : "project SQL"}. It can reveal drift and generate a review diff, but cannot be applied automatically.`
                : supportsRestorePlan
                ? "The generated plan describes how to make the live target match the selected snapshot. It opens as a read-only artifact first. OxideStudio does not execute migration SQL from this dialog."
                : identity?.driver === "sqlite"
                ? "SQLite differences generate a read-only rebuild review artifact. It may include a temporary table, preserved-column copy, index recreation, and foreign-key checks, but automatic apply remains disabled."
                : "Document and search snapshots preserve collection or index fields and indexes for drift review and diagrams. Restore plans remain disabled because these stores require driver-specific migration commands."}
            </div>

            <div className="mt-3 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.32)] p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-medium">
                <FileCode2 size={12} className="text-[hsl(var(--wb-accent))]" />
                Project DDL baseline
              </div>
              <p className="mt-1 text-[9px] leading-4 wb-muted">
                Parses portable CREATE TABLE / INDEX metadata from one bounded project SQL file or the bounded eligible set. The result is review-only until a dialect parser validates the full source contract.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  aria-label="Project DDL source"
                  value={selectedProjectDdlPath}
                  onChange={(event) => setSelectedProjectDdlPath(event.target.value)}
                  disabled={busy || projectDdlDocuments.length === 0}
                  className="h-7 min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 font-mono text-[10px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent)/0.65)] disabled:opacity-50"
                >
                  {projectDdlDocuments.length === 0 ? (
                    <option value="">No project SQL files available</option>
                  ) : (
                    <>
                      <option value={ALL_PROJECT_DDL_SOURCES}>
                        All eligible project SQL files ({projectDdlDocuments.length})
                      </option>
                      {projectDdlDocuments.map((document) => (
                        <option key={document.relativePath} value={document.relativePath}>
                          {document.relativePath}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <button
                  type="button"
                  className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                  disabled={busy || !selectedProjectDdlPath}
                  onClick={() => void importProjectDdl()}
                >
                  {operation === "import" ? <Loader2 size={11} className="animate-spin" /> : <FileCode2 size={11} />}
                  Create baseline
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                <input
                  ref={dbmlInputRef}
                  type="file"
                  accept=".dbml,text/plain"
                  className="hidden"
                  onChange={(event) => void importDbml(event.currentTarget.files?.[0])}
                />
                <input
                  ref={metadataInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(event) =>
                    void importMetadataJson(event.currentTarget.files?.[0])
                  }
                />
                <p className="min-w-0 flex-1 text-[9px] leading-4 wb-muted">
                  Import bounded DBML as a review-only baseline; unsupported semantics remain warnings.
                </p>
                <button
                  type="button"
                  className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                  disabled={busy}
                  onClick={() => dbmlInputRef.current?.click()}
                >
                  {operation === "import" ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                  Import DBML
                </button>
                <button
                  type="button"
                  className="wb-text-button h-7 shrink-0 gap-1.5 px-2.5 text-[10px]"
                  disabled={busy}
                  onClick={() => metadataInputRef.current?.click()}
                  title="Import ChartDB metadata-query JSON as a review-only baseline"
                >
                  {operation === "import" ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                  Metadata JSON
                </button>
              </div>
            </div>

            {selected && (
              <div className="mt-4 grid grid-cols-[120px_minmax(0,1fr)] gap-y-2 text-[10px]">
                <span className="wb-muted">Captured</span>
                <span>{formatTimestamp(selected.capturedAt)}</span>
                {selectedIsOffline && (
                  <>
                    <span className="wb-muted">Source mode</span>
                    <span>{selectedIsDbml ? "DBML" : selectedIsMetadata ? "Metadata JSON" : "Project DDL"} · review-only</span>
                    <span className="wb-muted">Source files</span>
                    <span
                      className="truncate font-mono text-[9px]"
                      title={selectedIsDbml || selectedIsMetadata ? selected.warnings.find((warning) => warning.startsWith("Source: "))?.slice(8) : selectedProjectDdlSources.join("\n")}
                    >
                      {selectedIsDbml || selectedIsMetadata
                        ? selected.warnings.find((warning) => warning.startsWith("Source: "))?.slice(8) || (selectedIsDbml ? "Imported DBML" : "Imported metadata JSON")
                        : selectedProjectDdlSources.length === 1
                        ? selectedProjectDdlSources[0] || "Project SQL"
                        : `${selectedProjectDdlSources.length} bounded project SQL files`}
                    </span>
                  </>
                )}
                <span className="wb-muted">{supportsSchemaReviewPlan ? "Relations" : "Objects"}</span>
                <span>{selected.relations.length.toLocaleString()}</span>
                <span className="wb-muted">Driver</span>
                <span>{selected.driver}</span>
                <span className="wb-muted">Fingerprint</span>
                <span className="break-all font-mono text-[9px]">{selected.fingerprint}</span>
              </div>
            )}

            {error && (
              <div className="mt-auto flex items-start gap-2 rounded-[4px] border border-red-400/20 bg-red-400/5 px-2.5 py-2 text-[10px] text-red-300" role="alert">
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <button
            type="button"
            className="wb-text-button h-7 gap-1.5 px-3 text-[10px]"
            disabled={busy}
            onClick={() => void capture()}
          >
            {operation === "capture" ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
            Capture current {supportsSchemaReviewPlan ? "schema" : "metadata"}
          </button>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[10px]" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="wb-text-button h-7 gap-1.5 px-3 text-[10px]"
              disabled={!selected || busy}
              onClick={openDiagram}
            >
              <Network size={12} /> Open diagram
            </button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-[132px] justify-center gap-1.5 px-3 text-[10px]"
              disabled={!selected || busy}
              title={
                supportsRestorePlan
                  ? "Compare the selected schema snapshot with live metadata"
                  : identity?.driver === "sqlite"
                  ? "Compare the selected schema snapshot and generate a blocked rebuild review"
                  : "Compare document or search metadata without generating restore commands"
              }
              onClick={() => void compare()}
            >
              {operation === "compare" ? <Loader2 size={12} className="animate-spin" /> : <GitCompareArrows size={12} />}
              {selectedSupportsRestorePlan
                ? identity?.driver === "sqlite"
                  ? "Preview rebuild plan"
                  : "Preview restore plan"
                : "Preview metadata diff"}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TargetCard({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised)/0.46)] px-3 py-3">
      <div className="text-[8px] uppercase tracking-[0.13em] wb-muted">{eyebrow}</div>
      <div className="mt-1.5 truncate text-[10px] font-medium" title={title}>{title}</div>
      <div className="mt-1 truncate font-mono text-[8px] wb-muted" title={detail}>{detail}</div>
    </div>
  );
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
