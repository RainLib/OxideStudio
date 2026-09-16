import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addSchemaDraftCheckConstraint,
  addSchemaDraftColumn,
  addSchemaDraftForeignKey,
  addSchemaDraftIndex,
  addSchemaDraftRelation,
  createSchemaDiagramDraftSnapshot,
  removeSchemaDraftColumn,
  removeSchemaDraftConstraint,
  removeSchemaDraftIndex,
  removeSchemaDraftRelation,
  renameSchemaDraftRelation,
  updateSchemaDraftColumn,
} from "@/features/schema-diff/model/schemaDiagramDraft";
import {
  commitSchemaDiagramDraftToCanvas,
  hydrateSchemaDiagramCanvasDraft,
  redoSchemaDiagramCanvas,
  undoSchemaDiagramCanvas,
} from "@/lib/schemaDiagramCanvasHistory";
import { suggestedSchemaDiagramForeignKeyName } from "@/lib/schemaDiagramRelationshipDrag";
import { schemaService } from "@/services/tauri/schema.service";
import {
  deleteSchemaDiagramDraft,
  loadSchemaDiagramDraft,
  saveSchemaDiagramDraft,
} from "@/services/schemaDiagramDraftStore";
import type { SchemaRelationSnapshot } from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";
import type {
  DraftPersistenceState,
  SchemaStructuredDraftDialogProps,
} from "@/features/schema-diff/model/schemaStructuredDraftDialog";

const MAX_VISIBLE_RELATIONS = 500;
type DraftColumn = SchemaRelationSnapshot["columns"][number];

export function useSchemaStructuredDraftDialog({
  open,
  snapshot,
  initialRelationName,
  initialForeignKey,
  canvasHistory,
  onCanvasHistoryChange,
  onClose,
}: SchemaStructuredDraftDialogProps) {
  const openSchemaDiffTab = useTabStore((state) => state.openSchemaDiffTab);
  const sessionDraft = canvasHistory.present.draft?.baseFingerprint === snapshot.fingerprint
    ? canvasHistory.present.draft
    : undefined;
  const draftRelations = sessionDraft?.relations || snapshot.relations;
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState("");
  const [newRelationName, setNewRelationName] = useState("");
  const [relationName, setRelationName] = useState("");
  const [pendingRelationDelete, setPendingRelationDelete] = useState(false);
  const [columnName, setColumnName] = useState("");
  const [columnType, setColumnType] = useState("");
  const [columnNullable, setColumnNullable] = useState(true);
  const [columnPrimary, setColumnPrimary] = useState(false);
  const [columnUnique, setColumnUnique] = useState(false);
  const [columnDefault, setColumnDefault] = useState("");
  const [columnComment, setColumnComment] = useState("");
  const [editingColumnName, setEditingColumnName] = useState<string | null>(null);
  const [indexName, setIndexName] = useState("");
  const [indexColumns, setIndexColumns] = useState("");
  const [indexUnique, setIndexUnique] = useState(false);
  const [foreignKeyName, setForeignKeyName] = useState("");
  const [foreignKeyColumns, setForeignKeyColumns] = useState("");
  const [foreignKeyTarget, setForeignKeyTarget] = useState("");
  const [foreignKeyTargetColumns, setForeignKeyTargetColumns] = useState("");
  const [checkName, setCheckName] = useState("");
  const [checkDefinition, setCheckDefinition] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [persistenceState, setPersistenceState] =
    useState<DraftPersistenceState>("idle");
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState(false);
  const persistenceGenerationRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastPersistedRelationsRef = useRef<SchemaRelationSnapshot[] | null>(null);
  const appliedForeignKeySeedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const generation = ++persistenceGenerationRef.current;
    let disposed = false;
    setSelectedName(
      initialRelationName && draftRelations.some(
        (relation) => relation.name === initialRelationName,
      )
        ? initialRelationName
        : draftRelations[0]?.name || null,
    );
    setRelationFilter("");
    setNewRelationName("");
    setError(null);
    setPendingRelationDelete(false);
    setPendingDiscard(false);
    setPersistenceReady(false);
    setPersistenceState("loading");
    setPersistenceNotice(null);
    setLastSavedAt(null);
    lastPersistedRelationsRef.current = null;
    appliedForeignKeySeedRef.current = null;

    void loadSchemaDiagramDraft(snapshot)
      .then((draft) => {
        if (
          disposed ||
          generation !== persistenceGenerationRef.current
        ) {
          return;
        }
        if (sessionDraft) {
          setPersistenceState("pending");
          setPersistenceNotice(
            "Using the current session draft and unified canvas history.",
          );
          return;
        }
        if (!draft) {
          setPersistenceState("idle");
          return;
        }
        if (draft.baseFingerprint !== snapshot.fingerprint) {
          setPersistenceState("stale");
          setLastSavedAt(draft.updatedAt);
          setPersistenceNotice(
            "A saved draft belongs to an older snapshot and was not restored. The first new edit will replace it.",
          );
          return;
        }
        onCanvasHistoryChange(hydrateSchemaDiagramCanvasDraft(canvasHistory, {
          baseFingerprint: draft.baseFingerprint,
          relations: draft.relations,
        }));
        lastPersistedRelationsRef.current = draft.relations;
        setSelectedName(
          initialRelationName && draft.relations.some(
            (relation) => relation.name === initialRelationName,
          )
            ? initialRelationName
            : draft.relations[0]?.name || null,
        );
        setLastSavedAt(draft.updatedAt);
        setPersistenceState("saved");
        setPersistenceNotice("Restored the project draft for this schema.");
      })
      .catch((loadError) => {
        if (
          disposed ||
          generation !== persistenceGenerationRef.current
        ) {
          return;
        }
        setPersistenceState("error");
        setPersistenceNotice(
          `The project draft could not be loaded: ${errorMessage(loadError)}`,
        );
      })
      .finally(() => {
        if (
          !disposed &&
          generation === persistenceGenerationRef.current
        ) {
          setPersistenceReady(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [initialRelationName, open, snapshot]);

  const selectedRelation = useMemo(
    () => draftRelations.find((relation) => relation.name === selectedName) || null,
    [draftRelations, selectedName],
  );
  const relationSearch = useMemo(() => {
    const needle = relationFilter.trim().toLowerCase();
    const matches = draftRelations.filter(
      (relation) => !needle || relation.name.toLowerCase().includes(needle),
    );
    return {
      visible: matches.slice(0, MAX_VISIBLE_RELATIONS),
      hiddenCount: Math.max(0, matches.length - MAX_VISIBLE_RELATIONS),
    };
  }, [draftRelations, relationFilter]);
  const visibleRelations = relationSearch.visible;
  const hiddenRelationCount = relationSearch.hiddenCount;

  useEffect(() => {
    setRelationName(selectedRelation?.name || "");
    setPendingRelationDelete(false);
    resetColumnForm();
    setIndexName("");
    setIndexColumns("");
    setForeignKeyName("");
    setForeignKeyColumns("");
    setForeignKeyTarget("");
    setForeignKeyTargetColumns("");
    setCheckName("");
    setCheckDefinition("");
  }, [selectedRelation?.name]);

  useEffect(() => {
    if (selectedName && !selectedRelation) {
      setSelectedName(draftRelations[0]?.name || null);
    }
  }, [draftRelations, selectedName, selectedRelation]);

  useEffect(() => {
    if (!open || !persistenceReady || isReviewing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const wantsRedo = key === "y" || (key === "z" && event.shiftKey);
      if (key !== "z" && key !== "y") return;
      event.preventDefault();
      onCanvasHistoryChange(
        wantsRedo
          ? redoSchemaDiagramCanvas(canvasHistory)
          : undoSchemaDiagramCanvas(canvasHistory),
      );
      setError(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canvasHistory, isReviewing, onCanvasHistoryChange, open, persistenceReady]);

  useEffect(() => {
    if (!open || !persistenceReady || !initialForeignKey) return;
    const seedKey = JSON.stringify(initialForeignKey);
    if (appliedForeignKeySeedRef.current === seedKey) return;
    const source = draftRelations.find(
      (relation) => relation.name === initialForeignKey.sourceRelation,
    );
    const target = draftRelations.find(
      (relation) => relation.name === initialForeignKey.targetRelation,
    );
    if (
      !source?.columns.some(
        (column) => column.name === initialForeignKey.sourceColumn,
      ) ||
      !target?.columns.some(
        (column) => column.name === initialForeignKey.targetColumn,
      )
    ) {
      appliedForeignKeySeedRef.current = seedKey;
      setError(
        "The dragged relationship references a column removed from the saved draft.",
      );
      return;
    }
    if (selectedName !== source.name) {
      setSelectedName(source.name);
      return;
    }
    setForeignKeyName(suggestedSchemaDiagramForeignKeyName(
      source.constraints.map((constraint) => constraint.name),
      {
        relationName: initialForeignKey.sourceRelation,
        columnName: initialForeignKey.sourceColumn,
      },
    ));
    setForeignKeyColumns(initialForeignKey.sourceColumn);
    setForeignKeyTarget(initialForeignKey.targetRelation);
    setForeignKeyTargetColumns(initialForeignKey.targetColumn);
    setError(null);
    appliedForeignKeySeedRef.current = seedKey;
  }, [draftRelations, initialForeignKey, open, persistenceReady, selectedName]);

  const enqueuePersist = useCallback((relations: SchemaRelationSnapshot[]) => {
    const generation = ++persistenceGenerationRef.current;
    setPersistenceState("saving");
    setPersistenceNotice(null);
    const operation = persistenceQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (relations === snapshot.relations) {
          await deleteSchemaDiagramDraft(snapshot);
          return null;
        }
        return saveSchemaDiagramDraft(snapshot, relations);
      });
    persistenceQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation.then(
      (saved) => {
        if (generation !== persistenceGenerationRef.current) return;
        lastPersistedRelationsRef.current = saved ? relations : null;
        setLastSavedAt(saved?.updatedAt || null);
        setPersistenceState(saved ? "saved" : "idle");
        setPersistenceNotice(
          saved ? "Draft saved to this project." : "Saved draft removed.",
        );
      },
      (saveError) => {
        if (generation === persistenceGenerationRef.current) {
          setPersistenceState("error");
          setPersistenceNotice(`Project draft save failed: ${errorMessage(saveError)}`);
        }
        throw saveError;
      },
    );
  }, [snapshot]);

  useEffect(() => {
    if (
      !open ||
      !persistenceReady ||
      draftRelations === lastPersistedRelationsRef.current ||
      (draftRelations === snapshot.relations &&
        lastPersistedRelationsRef.current === null)
    ) {
      return;
    }
    setPersistenceState("pending");
    setPersistenceNotice("Project autosave queued.");
    const timer = window.setTimeout(() => {
      void enqueuePersist(draftRelations).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draftRelations, enqueuePersist, open, persistenceReady, snapshot.relations]);

  const commit = (next: SchemaRelationSnapshot[]) => {
    onCanvasHistoryChange(commitSchemaDiagramDraftToCanvas(
      canvasHistory,
      snapshot.fingerprint,
      next,
      snapshot.relations,
    ));
    setError(null);
  };

  const mutate = (operation: () => SchemaRelationSnapshot[]) => {
    try {
      commit(operation());
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      return false;
    }
  };

  const createRelation = () => {
    let created = "";
    if (!mutate(() => {
      const next = addSchemaDraftRelation(draftRelations, newRelationName);
      created = newRelationName.trim();
      return next;
    })) return;
    setNewRelationName("");
    setSelectedName(created);
  };

  const renameRelation = () => {
    if (!selectedRelation) return;
    const nextName = relationName.trim();
    if (!mutate(() =>
      renameSchemaDraftRelation(draftRelations, selectedRelation.name, nextName),
    )) return;
    setSelectedName(nextName);
  };

  const deleteRelation = () => {
    if (!selectedRelation) return;
    if (!pendingRelationDelete) {
      setPendingRelationDelete(true);
      return;
    }
    const next = removeSchemaDraftRelation(draftRelations, selectedRelation.name);
    commit(next);
    setSelectedName(next[0]?.name || null);
  };

  const saveColumn = () => {
    if (!selectedRelation) return;
    const saved = editingColumnName
      ? mutate(() => updateSchemaDraftColumn(
          draftRelations,
          selectedRelation.name,
          editingColumnName,
          {
            name: columnName,
            dataType: columnType,
            nullable: columnNullable,
            defaultValue: columnDefault,
            comment: columnComment,
          },
        ))
      : mutate(() => addSchemaDraftColumn(draftRelations, selectedRelation.name, {
          name: columnName,
          dataType: columnType,
          nullable: columnNullable,
          primaryKey: columnPrimary,
          unique: columnUnique,
          defaultValue: columnDefault,
          comment: columnComment,
        }));
    if (saved) resetColumnForm();
  };

  const closeWithPersist = async () => {
    if (!persistenceReady || isReviewing) return;
    try {
      if (draftRelations !== lastPersistedRelationsRef.current) {
        await enqueuePersist(draftRelations);
      }
      onClose();
    } catch (closeError) {
      setError(
        `The draft remains open because it could not be saved: ${errorMessage(closeError)}`,
      );
    }
  };

  const discardDraft = async () => {
    if (!pendingDiscard) {
      setPendingDiscard(true);
      return;
    }
    setPersistenceReady(false);
    try {
      await enqueuePersist(snapshot.relations);
      onCanvasHistoryChange(commitSchemaDiagramDraftToCanvas(
        canvasHistory,
        snapshot.fingerprint,
        snapshot.relations,
        snapshot.relations,
      ));
      onClose();
    } catch (discardError) {
      setPersistenceReady(true);
      setError(`The saved draft could not be removed: ${errorMessage(discardError)}`);
    }
  };

  const reviewDiff = async () => {
    if (draftRelations === snapshot.relations || isReviewing) return;
    setIsReviewing(true);
    setError(null);
    try {
      if (draftRelations !== lastPersistedRelationsRef.current) {
        await enqueuePersist(draftRelations);
      }
      const draft = createSchemaDiagramDraftSnapshot(snapshot, draftRelations);
      const plan = await schemaService.compareSchemaSnapshots(draft, snapshot);
      openSchemaDiffTab(plan, draft, snapshot);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsReviewing(false);
    }
  };

  function resetColumnForm() {
    setEditingColumnName(null);
    setColumnName("");
    setColumnType("");
    setColumnNullable(true);
    setColumnPrimary(false);
    setColumnUnique(false);
    setColumnDefault("");
    setColumnComment("");
  }

  const dirty = draftRelations !== snapshot.relations;

  const undo = () => {
    onCanvasHistoryChange(undoSchemaDiagramCanvas(canvasHistory));
    setError(null);
  };
  const redo = () => {
    onCanvasHistoryChange(redoSchemaDiagramCanvas(canvasHistory));
    setError(null);
  };
  const editColumn = (column: DraftColumn) => {
    setEditingColumnName(column.name);
    setColumnName(column.name);
    setColumnType(column.data_type);
    setColumnNullable(column.is_nullable);
    setColumnPrimary(column.is_primary_key);
    setColumnUnique(Boolean(column.is_unique));
    setColumnDefault(column.default_value || "");
    setColumnComment(column.comment || "");
    setError(null);
  };
  const removeColumn = (columnName: string) => {
    if (!selectedRelation) return;
    mutate(() => removeSchemaDraftColumn(draftRelations, selectedRelation.name, columnName));
  };
  const addIndex = () => {
    if (!selectedRelation) return;
    if (mutate(() => addSchemaDraftIndex(draftRelations, selectedRelation.name, {
      name: indexName,
      columns: commaList(indexColumns),
      is_unique: indexUnique,
    }))) {
      setIndexName("");
      setIndexColumns("");
      setIndexUnique(false);
    }
  };
  const removeIndex = (name: string) => {
    if (!selectedRelation) return;
    mutate(() => removeSchemaDraftIndex(draftRelations, selectedRelation.name, name));
  };
  const addForeignKey = () => {
    if (!selectedRelation) return;
    if (mutate(() => addSchemaDraftForeignKey(draftRelations, selectedRelation.name, {
      name: foreignKeyName,
      columns: commaList(foreignKeyColumns),
      referencedSchema: snapshot.schemaName,
      referencedTable: foreignKeyTarget,
      referencedColumns: commaList(foreignKeyTargetColumns),
    }))) {
      setForeignKeyName("");
      setForeignKeyColumns("");
      setForeignKeyTarget("");
      setForeignKeyTargetColumns("");
    }
  };
  const addCheck = () => {
    if (!selectedRelation) return;
    if (mutate(() => addSchemaDraftCheckConstraint(
      draftRelations,
      selectedRelation.name,
      checkName,
      checkDefinition,
    ))) {
      setCheckName("");
      setCheckDefinition("");
    }
  };
  const removeConstraint = (name: string) => {
    if (!selectedRelation) return;
    mutate(() => removeSchemaDraftConstraint(draftRelations, selectedRelation.name, name));
  };

  return {
    open,
    snapshot,
    canvasHistory,
    selectedName,
    setSelectedName,
    relationFilter,
    setRelationFilter,
    newRelationName,
    setNewRelationName,
    relationName,
    setRelationName,
    pendingRelationDelete,
    columnName,
    setColumnName,
    columnType,
    setColumnType,
    columnNullable,
    setColumnNullable,
    columnPrimary,
    setColumnPrimary,
    columnUnique,
    setColumnUnique,
    columnDefault,
    setColumnDefault,
    columnComment,
    setColumnComment,
    editingColumnName,
    indexName,
    setIndexName,
    indexColumns,
    setIndexColumns,
    indexUnique,
    setIndexUnique,
    foreignKeyName,
    setForeignKeyName,
    foreignKeyColumns,
    setForeignKeyColumns,
    foreignKeyTarget,
    setForeignKeyTarget,
    foreignKeyTargetColumns,
    setForeignKeyTargetColumns,
    checkName,
    setCheckName,
    checkDefinition,
    setCheckDefinition,
    error,
    isReviewing,
    persistenceReady,
    persistenceState,
    persistenceNotice,
    lastSavedAt,
    pendingDiscard,
    selectedRelation,
    visibleRelations,
    hiddenRelationCount,
    draftRelations,
    dirty,
    createRelation,
    renameRelation,
    deleteRelation,
    saveColumn,
    resetColumnForm,
    closeWithPersist,
    discardDraft,
    reviewDiff,
    undo,
    redo,
    editColumn,
    removeColumn,
    addIndex,
    removeIndex,
    addForeignKey,
    addCheck,
    removeConstraint,
  };
}

function commaList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
