import type { SchemaStructuredDraftForeignKeySeed } from "@/components/workspace/SchemaStructuredDraftDialog";
import { useDiagramCanvasPersistence } from "@/features/schema-diagram/hooks/useDiagramCanvasPersistence";
import { useDiagramExport } from "@/features/schema-diagram/hooks/useDiagramExport";
import { useDiagramHistory } from "@/features/schema-diagram/hooks/useDiagramHistory";
import { useDiagramLayout } from "@/features/schema-diagram/hooks/useDiagramLayout";
import { useDiagramViewport } from "@/features/schema-diagram/hooks/useDiagramViewport";
import { createDiagramAreaActions } from "@/features/schema-diagram/model/createDiagramAreaActions";
import { createDiagramNavigationActions } from "@/features/schema-diagram/model/createDiagramNavigationActions";
import { createDiagramNoteActions } from "@/features/schema-diagram/model/createDiagramNoteActions";
import { EMPTY_CANVAS_HISTORY } from "@/features/schema-diagram/model/diagramConstants";
import { DiagramAreaToolbar } from "@/features/schema-diagram/ui/DiagramAreaToolbar";
import { DiagramDialogs } from "@/features/schema-diagram/ui/DiagramDialogs";
import { DiagramHeader } from "@/features/schema-diagram/ui/DiagramHeader";
import { DiagramInspector } from "@/features/schema-diagram/ui/DiagramInspector";
import { DiagramToolbar } from "@/features/schema-diagram/ui/DiagramToolbar";
import { DiagramWorkspaceCanvas } from "@/features/schema-diagram/ui/DiagramWorkspaceCanvas";
import { type SchemaDiagramEdge } from "@/lib/schemaDiagram";
import { type SchemaDiagramCanvasHistory } from "@/lib/schemaDiagramCanvasHistory";
import { cn } from "@/lib/utils";
import { type SchemaDiagramNoteColor } from "@/services/schemaDiagramCanvasStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";
import { useWorkbenchLayoutStore } from "@/store/useWorkbenchLayoutStore";
import { useCallback, useEffect, useMemo, useState } from "react";

export function SchemaDiagramView() {
  const {
    tabs,
    activeTabId,
    selectSchemaDiagramRelation,
    setSchemaDiagramCanvasHistory,
    selectSchemaDiagramArea,
    selectSchemaDiagramRelations,
  } = useTabStore();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const setActiveConnection = useConnectionStore(
    (state) => state.setActiveConnection,
  );
  const setActiveToolWindow = useWorkbenchLayoutStore(
    (state) => state.setActiveToolWindow,
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [dbmlDraftOpen, setDbmlDraftOpen] = useState(false);
  const [structuredDraftOpen, setStructuredDraftOpen] = useState(false);
  const [foreignKeySeed, setForeignKeySeed] =
    useState<SchemaStructuredDraftForeignKeySeed | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteContentDraft, setNoteContentDraft] = useState("");
  const [noteColorDraft, setNoteColorDraft] =
    useState<SchemaDiagramNoteColor>("amber");
  const [notePositionDraft, setNotePositionDraft] = useState({ x: 24, y: 24 });
  const [pendingNoteDelete, setPendingNoteDelete] = useState(false);
  const [renamingAreaId, setRenamingAreaId] = useState<string | null>(null);
  const [areaNameDraft, setAreaNameDraft] = useState("");
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const snapshot = activeTab?.schemaDiagramSnapshot;
  const canvasHistory =
    activeTab?.schemaDiagramCanvasHistory || EMPTY_CANVAS_HISTORY;
  const updateCanvasHistory = useCallback(
    (history: SchemaDiagramCanvasHistory) => {
      if (activeTab?.id) {
        setSchemaDiagramCanvasHistory(activeTab.id, history);
      }
    },
    [activeTab?.id, setSchemaDiagramCanvasHistory],
  );
  const areas = canvasHistory.present.areas;
  const diagramNotes = canvasHistory.present.notes;
  const selectedAreaId = activeTab?.selectedDiagramAreaId || "";
  const activeSelectedRelationName =
    activeTab?.selectedDiagramRelationName || null;
  const selectedRelationNames = useMemo(
    () =>
      new Set(
        activeTab?.selectedDiagramRelationNames?.length
          ? activeTab.selectedDiagramRelationNames
          : activeTab?.selectedDiagramRelationName
            ? [activeTab.selectedDiagramRelationName]
            : [],
      ),
    [
      activeTab?.selectedDiagramRelationName,
      activeTab?.selectedDiagramRelationNames,
    ],
  );
  const selectedRelationList = useMemo(
    () => [...selectedRelationNames],
    [selectedRelationNames],
  );
  const {
    query,
    setQuery,
    keysOnly,
    setKeysOnly,
    relationScope,
    setRelationScope,
    layout,
    fullLayout,
    areaBounds,
    canvasExtent,
    snapshotRelationsByName,
    fullEdgeIndexesByRelation,
  } = useDiagramLayout({
    snapshot,
    activeSelectedRelationName,
    areas,
    selectedAreaId,
    diagramNotes,
  });

  useEffect(() => {
    setRelationScope("all");
    setRenamingAreaId(null);
    setAreaNameDraft("");
  }, [snapshot?.id]);

  const { canvasPersistenceReady, canvasPersistenceState } =
    useDiagramCanvasPersistence({
      activeTab,
      snapshot,
      areas,
      diagramNotes,
      setSchemaDiagramCanvasHistory,
    });

  const {
    exportScope,
    setExportScope,
    exportBackground,
    setExportBackground,
    isRasterizing,
    exportSvg,
    exportRaster,
    exportDbml,
  } = useDiagramExport({
    fullLayout,
    layout,
    snapshot,
    diagramNotes,
  });

  const {
    zoom,
    setZoom,
    viewportRef,
    scheduleViewportWindowUpdate,
    viewportIndex,
    viewportNodes,
    viewportEdges,
    fitDiagram,
  } = useDiagramViewport({
    layout,
    canvasExtent,
  });

  const { undoCanvas, redoCanvas } = useDiagramHistory({
    activeTab,
    canvasHistory,
    setSchemaDiagramCanvasHistory,
    editingNoteId,
    renamingAreaId,
    dbmlDraftOpen,
    structuredDraftOpen,
    selectedAreaId,
    areas,
    selectSchemaDiagramArea,
    relationScope,
    setRelationScope,
  });

  if (
    !activeTab ||
    activeTab.type !== "schema_diagram" ||
    !snapshot ||
    !layout ||
    !fullLayout ||
    !viewportIndex
  ) {
    return null;
  }

  const selectedRelation = activeTab.selectedDiagramRelationName
    ? snapshotRelationsByName.get(activeTab.selectedDiagramRelationName) || null
    : null;
  const selectedName = selectedRelation?.name || null;
  const selectedIsHidden = Boolean(
    selectedName && !viewportIndex.nodesByName.has(selectedName),
  );
  const selectedArea = areas.find((area) => area.id === selectedAreaId) || null;
  const relatedEdges = selectedName
    ? [...(fullEdgeIndexesByRelation.get(selectedName) || [])]
        .map((edgeIndex) => fullLayout.edges[edgeIndex])
        .filter((edge): edge is SchemaDiagramEdge => Boolean(edge))
    : [];

  const { selectRelation, revealRelation, focusRelatedRelation } =
    createDiagramNavigationActions({
      selectedRelationNames,
      selectSchemaDiagramRelations,
      activeTab,
      selectSchemaDiagramRelation,
      setActiveConnection,
      snapshot,
      setActiveToolWindow,
      activeProjectId,
      setQuery,
      setRelationScope,
      fullLayout,
      viewportRef,
      zoom,
    });

  const {
    createArea,
    removeArea,
    moveRelationsToArea,
    removeRelationsFromAreas,
    autoArrangeArea,
    autoArrangeAllAreas,
    beginRenameArea,
    areaNameError,
    commitAreaRename,
    removeSelectedArea,
    moveSelectionToArea,
    autoArrangeSelectedArea,
  } = createDiagramAreaActions({
    areas,
    setSchemaDiagramCanvasHistory,
    activeTab,
    canvasHistory,
    selectSchemaDiagramArea,
    selectedAreaId,
    relationScope,
    setRelationScope,
    fullLayout,
    setAreaNameDraft,
    setRenamingAreaId,
    areaNameDraft,
    renamingAreaId,
    selectedRelationNames,
  });

  const {
    beginCreateNote,
    beginEditNote,
    saveNote,
    removeEditingNote,
    moveNote,
    resizeNote,
  } = createDiagramNoteActions({
    setSchemaDiagramCanvasHistory,
    activeTab,
    canvasHistory,
    viewportRef,
    zoom,
    setNoteContentDraft,
    setNoteColorDraft,
    setNotePositionDraft,
    setPendingNoteDelete,
    setEditingNoteId,
    noteContentDraft,
    editingNoteId,
    diagramNotes,
    notePositionDraft,
    noteColorDraft,
    pendingNoteDelete,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <DiagramHeader
        snapshot={snapshot}
        layout={layout}
        selectedName={selectedName}
        revealRelation={revealRelation}
      />

      <DiagramToolbar
        query={query}
        setQuery={setQuery}
        keysOnly={keysOnly}
        setKeysOnly={setKeysOnly}
        relationScope={relationScope}
        setRelationScope={setRelationScope}
        selectedName={selectedName}
        selectedArea={selectedArea}
        setZoom={setZoom}
        zoom={zoom}
        fitDiagram={fitDiagram}
        exportScope={exportScope}
        setExportScope={setExportScope}
        exportBackground={exportBackground}
        setExportBackground={setExportBackground}
        exportSvg={exportSvg}
        layout={layout}
        diagramNotes={diagramNotes}
        exportRaster={exportRaster}
        isRasterizing={isRasterizing}
        exportDbml={exportDbml}
        setForeignKeySeed={setForeignKeySeed}
        setStructuredDraftOpen={setStructuredDraftOpen}
        canvasPersistenceReady={canvasPersistenceReady}
        beginCreateNote={beginCreateNote}
        setDbmlDraftOpen={setDbmlDraftOpen}
        setInspectorCollapsed={setInspectorCollapsed}
        inspectorCollapsed={inspectorCollapsed}
        selectedIsHidden={selectedIsHidden}
        focusRelatedRelation={focusRelatedRelation}
      />

      <DiagramAreaToolbar
        createArea={createArea}
        selectedAreaId={selectedAreaId}
        selectSchemaDiagramArea={selectSchemaDiagramArea}
        activeTab={activeTab}
        areas={areas}
        selectedArea={selectedArea}
        selectedRelationNames={selectedRelationNames}
        moveSelectionToArea={moveSelectionToArea}
        autoArrangeSelectedArea={autoArrangeSelectedArea}
        beginRenameArea={beginRenameArea}
        removeSelectedArea={removeSelectedArea}
        canvasHistory={canvasHistory}
        undoCanvas={undoCanvas}
        redoCanvas={redoCanvas}
        diagramNotes={diagramNotes}
        canvasPersistenceState={canvasPersistenceState}
      />

      <div
        className={cn(
          "grid min-h-0 flex-1",
          inspectorCollapsed
            ? "grid-cols-[minmax(0,1fr)]"
            : "grid-cols-[minmax(0,1fr)_260px]",
        )}
      >
        <DiagramWorkspaceCanvas
          viewportRef={viewportRef}
          scheduleViewportWindowUpdate={scheduleViewportWindowUpdate}
          layout={layout}
          diagramNotes={diagramNotes}
          query={query}
          canvasExtent={canvasExtent}
          zoom={zoom}
          areaBounds={areaBounds}
          selectedAreaId={selectedAreaId}
          selectSchemaDiagramArea={selectSchemaDiagramArea}
          activeTab={activeTab}
          beginRenameArea={beginRenameArea}
          autoArrangeArea={autoArrangeArea}
          removeArea={removeArea}
          viewportIndex={viewportIndex}
          viewportEdges={viewportEdges}
          selectedName={selectedName}
          viewportNodes={viewportNodes}
          selectedRelationNames={selectedRelationNames}
          selectRelation={selectRelation}
          revealRelation={revealRelation}
          areas={areas}
          createArea={createArea}
          moveRelationsToArea={moveRelationsToArea}
          removeRelationsFromAreas={removeRelationsFromAreas}
          snapshot={snapshot}
          setForeignKeySeed={setForeignKeySeed}
          setStructuredDraftOpen={setStructuredDraftOpen}
          beginEditNote={beginEditNote}
          moveNote={moveNote}
          resizeNote={resizeNote}
          selectedRelationList={selectedRelationList}
          autoArrangeAllAreas={autoArrangeAllAreas}
        />

        {!inspectorCollapsed && (
          <DiagramInspector
            selectedRelation={selectedRelation}
            relatedEdges={relatedEdges}
            focusRelatedRelation={focusRelatedRelation}
          />
        )}
      </div>
      <DiagramDialogs
        renamingAreaId={renamingAreaId}
        setRenamingAreaId={setRenamingAreaId}
        commitAreaRename={commitAreaRename}
        areaNameDraft={areaNameDraft}
        setAreaNameDraft={setAreaNameDraft}
        areaNameError={areaNameError}
        editingNoteId={editingNoteId}
        noteContentDraft={noteContentDraft}
        noteColorDraft={noteColorDraft}
        pendingNoteDelete={pendingNoteDelete}
        setNoteContentDraft={setNoteContentDraft}
        setNoteColorDraft={setNoteColorDraft}
        removeEditingNote={removeEditingNote}
        setEditingNoteId={setEditingNoteId}
        setPendingNoteDelete={setPendingNoteDelete}
        saveNote={saveNote}
        dbmlDraftOpen={dbmlDraftOpen}
        snapshot={snapshot}
        setDbmlDraftOpen={setDbmlDraftOpen}
        structuredDraftOpen={structuredDraftOpen}
        foreignKeySeed={foreignKeySeed}
        selectedName={selectedName}
        canvasHistory={canvasHistory}
        updateCanvasHistory={updateCanvasHistory}
        setStructuredDraftOpen={setStructuredDraftOpen}
        setForeignKeySeed={setForeignKeySeed}
      />
    </div>
  );
}
