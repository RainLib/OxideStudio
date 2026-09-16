import { EMPTY_CANVAS_HISTORY } from "@/features/schema-diagram/model/diagramConstants";
import type { TabData } from "@/features/workspace-tabs/model/types";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import { createSchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import {
  loadSchemaDiagramCanvas,
  saveSchemaDiagramCanvas,
} from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { useTabStore } from "@/store/useTabStore";
import { useEffect, useRef, useState } from "react";

interface UseDiagramCanvasPersistenceContext {
  activeTab: Pick<TabData, "id" | "schemaDiagramCanvasHistory"> | undefined;
  snapshot: SchemaSnapshot | undefined;
  areas: SchemaDiagramArea[];
  diagramNotes: SchemaDiagramNote[];
  setSchemaDiagramCanvasHistory: (
    tabId: string,
    history: SchemaDiagramCanvasHistory,
  ) => void;
}

export function useDiagramCanvasPersistence({
  activeTab,
  snapshot,
  areas,
  diagramNotes,
  setSchemaDiagramCanvasHistory,
}: UseDiagramCanvasPersistenceContext) {
  const [canvasPersistenceReady, setCanvasPersistenceReady] = useState(false);
  const [canvasPersistenceState, setCanvasPersistenceState] = useState<
    "loading" | "ready" | "saving" | "error"
  >("loading");
  const canvasLoadGenerationRef = useRef(0);
  const canvasSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestCanvasByTabRef = useRef(
    new Map<
      string,
      {
        snapshot: SchemaSnapshot;
        areas: typeof EMPTY_CANVAS_HISTORY.present.areas;
        notes: SchemaDiagramNote[];
        ready: boolean;
      }
    >(),
  );

  useEffect(() => {
    if (!activeTab || !snapshot) return;
    latestCanvasByTabRef.current.set(activeTab.id, {
      snapshot,
      areas,
      notes: diagramNotes,
      ready: canvasPersistenceReady,
    });
  }, [activeTab, areas, canvasPersistenceReady, diagramNotes, snapshot]);

  useEffect(() => {
    if (!snapshot || !activeTab) return;
    const generation = ++canvasLoadGenerationRef.current;
    const tabId = activeTab.id;
    const initialHistory = activeTab.schemaDiagramCanvasHistory;
    const hasSessionHistory = Boolean(
      initialHistory?.past.length ||
        initialHistory?.future.length ||
        initialHistory?.present.draft,
    );
    let disposed = false;
    setCanvasPersistenceReady(false);
    setCanvasPersistenceState("loading");
    void loadSchemaDiagramCanvas(snapshot)
      .then((canvas) => {
        if (
          disposed ||
          generation !== canvasLoadGenerationRef.current ||
          !canvas ||
          hasSessionHistory
        ) {
          return;
        }
        const currentTab = useTabStore
          .getState()
          .tabs.find((tab) => tab.id === tabId);
        if (currentTab?.schemaDiagramCanvasHistory !== initialHistory) {
          return;
        }
        setSchemaDiagramCanvasHistory(
          tabId,
          createSchemaDiagramCanvasHistory(canvas.areas, canvas.notes),
        );
      })
      .catch((loadError) => {
        if (!disposed && generation === canvasLoadGenerationRef.current) {
          console.warn(
            "Failed to restore the project diagram canvas",
            loadError,
          );
          setCanvasPersistenceState("error");
        }
      })
      .finally(() => {
        if (!disposed && generation === canvasLoadGenerationRef.current) {
          setCanvasPersistenceReady(true);
          setCanvasPersistenceState((current) =>
            current === "error" ? current : "ready",
          );
        }
      });
    return () => {
      disposed = true;
    };
  }, [activeTab?.id, setSchemaDiagramCanvasHistory, snapshot]);

  useEffect(() => {
    if (!snapshot || !activeTab || !canvasPersistenceReady) return;
    const generation = canvasLoadGenerationRef.current;
    const timer = window.setTimeout(() => {
      setCanvasPersistenceState("saving");
      const operation = canvasSaveQueueRef.current
        .catch(() => undefined)
        .then(() =>
          saveSchemaDiagramCanvas(snapshot, areas, diagramNotes).then(
            () => undefined,
          ),
        );
      canvasSaveQueueRef.current = operation.catch(() => undefined);
      void operation.then(
        () => {
          if (generation === canvasLoadGenerationRef.current) {
            setCanvasPersistenceState("ready");
          }
        },
        (saveError) => {
          if (generation === canvasLoadGenerationRef.current) {
            console.warn(
              "Failed to save the project diagram canvas",
              saveError,
            );
            setCanvasPersistenceState("error");
          }
        },
      );
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeTab?.id, areas, canvasPersistenceReady, diagramNotes, snapshot]);

  useEffect(() => {
    const tabId = activeTab?.id;
    if (!tabId) return;
    return () => {
      const pending = latestCanvasByTabRef.current.get(tabId);
      latestCanvasByTabRef.current.delete(tabId);
      if (!pending?.ready) return;
      const operation = canvasSaveQueueRef.current
        .catch(() => undefined)
        .then(() =>
          saveSchemaDiagramCanvas(
            pending.snapshot,
            pending.areas,
            pending.notes,
          ).then(() => undefined),
        );
      canvasSaveQueueRef.current = operation.catch(() => undefined);
    };
  }, [activeTab?.id]);

  return { canvasPersistenceReady, canvasPersistenceState };
}
