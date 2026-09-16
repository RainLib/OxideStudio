import { useEffect, useMemo, useRef, useState } from "react";
import {
  captureAndSaveSchemaSnapshot,
  compareSnapshotToLive,
  deleteSchemaSnapshot,
  listSchemaSnapshots,
  saveSchemaSnapshot,
} from "@/services/schemaSnapshotStore";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { projectFilesService } from "@/services/tauri";
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
import { chartDbMetadataQueryForDriver } from "@/features/schema-diff/model/chartDbMetadataQueries";
import {
  schemaComparisonNextPhase,
  schemaComparisonPhaseLabel,
  type SchemaComparisonPhase,
} from "@/features/schema-diff/model/schemaComparisonProgress";
import {
  ALL_PROJECT_DDL_SOURCES,
  type SchemaSnapshotDialogProps,
} from "@/features/schema-diff/model/schemaSnapshotDialog";

export function useSchemaSnapshotDialog({
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
  const [comparisonProgress, setComparisonProgress] =
    useState<SchemaComparisonPhase | null>(null);
  const [importSource, setImportSource] = useState<
    "project" | "ddl" | "dbml" | "metadata" | null
  >(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedMetadataQuery, setCopiedMetadataQuery] = useState(false);
  const ddlInputRef = useRef<HTMLInputElement>(null);
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
  const { startTask, updateTask, finishTask, failTask } = useTaskStore();
  const supportsRestorePlan =
    identity?.driver === "postgres" || identity?.driver === "mysql";
  const supportsSchemaReviewPlan =
    supportsRestorePlan || identity?.driver === "sqlite";
  const objectLabel = supportsSchemaReviewPlan ? "relations" : "objects";
  const selected = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedId) || null,
    [selectedId, snapshots],
  );
  const selectedIsProjectDdl = Boolean(
    selected && isProjectDdlSnapshot(selected),
  );
  const selectedIsDbml = Boolean(selected && isSchemaDbmlSnapshot(selected));
  const selectedIsMetadata = Boolean(
    selected && isChartDbMetadataSnapshot(selected),
  );
  const selectedIsOffline =
    selectedIsProjectDdl || selectedIsDbml || selectedIsMetadata;
  const nextComparisonProgress = comparisonProgress
    ? schemaComparisonNextPhase(comparisonProgress)
    : null;
  const selectedProjectDdlSources = useMemo(
    () =>
      selected && isProjectDdlSnapshot(selected)
        ? projectDdlSnapshotSources(selected)
        : [],
    [selected],
  );
  const metadataQuery = useMemo(
    () =>
      identity
        ? chartDbMetadataQueryForDriver(
            identity.driver,
            identity.schemaName,
            identity.databaseName,
          )
        : null,
    [identity],
  );
  const selectedSupportsRestorePlan =
    supportsSchemaReviewPlan && !selectedIsOffline;

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
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
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
    setCopiedMetadataQuery(false);
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
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
    }
  };

  const importProjectDdl = async () => {
    if (operation || !selectedProjectDdlPath) return;
    const documents =
      selectedProjectDdlPath === ALL_PROJECT_DDL_SOURCES
        ? [...projectDdlDocuments].sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath),
          )
        : projectDdlDocuments.filter(
            (candidate) => candidate.relativePath === selectedProjectDdlPath,
          );
    if (documents.length === 0) return;
    const sourceLabel =
      documents.length === 1
        ? documents[0]!.relativePath
        : `${documents.length} project SQL files`;
    const taskId = startTask({
      kind: "introspection",
      title: `Parse project DDL`,
      detail: sourceLabel,
    });
    setOperation("import");
    setImportSource("project");
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
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      setImportSource(null);
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
    setImportSource("dbml");
    setError(null);
    try {
      const snapshot = createSchemaDbmlSnapshot(
        identity,
        file.name,
        await file.text(),
      );
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
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      setImportSource(null);
      if (dbmlInputRef.current) dbmlInputRef.current.value = "";
    }
  };

  const importDdl = async (file: File | undefined) => {
    if (!file || operation) return;
    if (file.size > 8 * 1024 * 1024) {
      setError("SQL DDL review import is limited to 8 MiB per file.");
      if (ddlInputRef.current) ddlInputRef.current.value = "";
      return;
    }
    const taskId = startTask({
      kind: "introspection",
      title: "Parse SQL DDL baseline",
      detail: file.name,
    });
    setOperation("import");
    setImportSource("ddl");
    setError(null);
    try {
      const snapshot = createProjectDdlSnapshot(
        identity,
        file.name,
        await file.text(),
      );
      if (snapshot.relations.length === 0) {
        throw new Error("No supported CREATE TABLE statement was found.");
      }
      await saveSchemaSnapshot(snapshot);
      setSnapshots((current) => [
        snapshot,
        ...current.filter((candidate) => candidate.id !== snapshot.id),
      ]);
      setSelectedId(snapshot.id);
      finishTask(
        taskId,
        `${snapshot.relations.length.toLocaleString()} DDL relations parsed for review`,
      );
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      setImportSource(null);
      if (ddlInputRef.current) ddlInputRef.current.value = "";
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
    setImportSource("metadata");
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
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      setImportSource(null);
      if (metadataInputRef.current) metadataInputRef.current.value = "";
    }
  };

  const copyMetadataQuery = async () => {
    if (!metadataQuery) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(metadataQuery.query);
      setCopiedMetadataQuery(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to copy the metadata query.",
      );
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
    setComparisonProgress("capture-target");
    setError(null);
    try {
      const { target, plan } = await compareSnapshotToLive(
        selected,
        identity,
        (phase) => {
          setComparisonProgress(phase);
          updateTask(taskId, { detail: schemaComparisonPhaseLabel(phase) });
        },
      );
      setComparisonProgress("open-review");
      updateTask(taskId, { detail: schemaComparisonPhaseLabel("open-review") });
      openSchemaDiffTab(plan, selected, target);
      finishTask(
        taskId,
        `${plan.summary.total.toLocaleString()} schema changes found`,
      );
      onClose();
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : String(nextError);
      setError(message);
      failTask(taskId, message);
    } finally {
      setOperation(null);
      setComparisonProgress(null);
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
      const remaining = snapshots.filter(
        (candidate) => candidate.id !== snapshot.id,
      );
      setSnapshots(remaining);
      if (selectedId === snapshot.id) {
        setSelectedId(remaining[0]?.id || null);
      }
      setPendingDeleteId(null);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
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

  return {
    snapshots,
    projectDdlDocuments,
    selectedProjectDdlPath,
    selectedId,
    isLoading,
    operation,
    comparisonProgress,
    importSource,
    pendingDeleteId,
    deletingId,
    error,
    copiedMetadataQuery,
    ddlInputRef,
    dbmlInputRef,
    metadataInputRef,
    supportsRestorePlan,
    supportsSchemaReviewPlan,
    objectLabel,
    selected,
    selectedIsProjectDdl,
    selectedIsDbml,
    selectedIsMetadata,
    selectedIsOffline,
    nextComparisonProgress,
    selectedProjectDdlSources,
    metadataQuery,
    selectedSupportsRestorePlan,
    busy,
    setSelectedProjectDdlPath,
    setSelectedId,
    setPendingDeleteId,
    capture,
    importProjectDdl,
    importDbml,
    importDdl,
    importMetadataJson,
    copyMetadataQuery,
    compare,
    remove,
    openDiagram,
  };
}

export type SchemaSnapshotDialogController = NonNullable<
  ReturnType<typeof useSchemaSnapshotDialog>
>;
