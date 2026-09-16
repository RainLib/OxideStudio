import {
  buildSchemaDiagram,
  schemaDiagramRelatedRelationNames,
} from "@/lib/schemaDiagram";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import { applySchemaDiagramAreas } from "@/lib/schemaDiagramAreas";
import { reuseFullSchemaDiagramLayout } from "@/lib/schemaDiagramLayoutMode";
import { buildSchemaDiagramEdgeIndex } from "@/lib/schemaDiagramViewport";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { useMemo, useState } from "react";

interface UseDiagramLayoutContext {
  snapshot: SchemaSnapshot | undefined;
  activeSelectedRelationName: string | null;
  areas: SchemaDiagramArea[];
  selectedAreaId: string;
  diagramNotes: SchemaDiagramNote[];
}

export function useDiagramLayout({
  snapshot,
  activeSelectedRelationName,
  areas,
  selectedAreaId,
  diagramNotes,
}: UseDiagramLayoutContext) {
  const [query, setQuery] = useState("");
  const [keysOnly, setKeysOnly] = useState(false);
  const [relationScope, setRelationScope] = useState<
    "all" | "related" | "area"
  >("all");

  const scopedRelationNames = useMemo(() => {
    if (!snapshot || relationScope === "all") return undefined;
    if (relationScope === "related") {
      return activeSelectedRelationName
        ? schemaDiagramRelatedRelationNames(
            snapshot,
            activeSelectedRelationName,
          )
        : new Set<string>();
    }
    return new Set(
      areas.find((area) => area.id === selectedAreaId)?.relationNames || [],
    );
  }, [
    activeSelectedRelationName,
    areas,
    relationScope,
    selectedAreaId,
    snapshot,
  ]);
  const fullBaseLayout = useMemo(
    // Keep coordinates identical to the visible unfiltered layout. A second
    // 50-column layout made related-table focus scroll to the wrong location
    // and inflated work for wide schemas.
    () => (snapshot ? buildSchemaDiagram(snapshot, { maxColumns: 18 }) : null),
    [snapshot],
  );
  const baseLayout = useMemo(() => {
    // The default canvas previously constructed the same unfiltered layout
    // twice: once here and once above for related-table navigation. Reuse
    // the full layout until a view-specific filter actually changes it.
    if (!snapshot) return null;
    if (
      reuseFullSchemaDiagramLayout({
        query,
        keysOnly,
        hasRelationScope: Boolean(scopedRelationNames),
      })
    )
      return fullBaseLayout;
    return buildSchemaDiagram(snapshot, {
      query,
      keysOnly,
      maxColumns: 18,
      relationNames: scopedRelationNames,
    });
  }, [fullBaseLayout, keysOnly, query, scopedRelationNames, snapshot]);
  const areaLayout = useMemo(
    () => (baseLayout ? applySchemaDiagramAreas(baseLayout, areas) : null),
    [areas, baseLayout],
  );
  const fullAreaLayout = useMemo(
    () =>
      fullBaseLayout ? applySchemaDiagramAreas(fullBaseLayout, areas) : null,
    [areas, fullBaseLayout],
  );
  const layout = areaLayout?.layout || null;
  const fullLayout = fullAreaLayout?.layout || null;
  const areaBounds = areaLayout?.areaBounds || [];
  const canvasExtent = useMemo(
    () => ({
      width: Math.max(
        layout?.width || 0,
        ...diagramNotes.map((note) => note.x + note.width + 48),
      ),
      height: Math.max(
        layout?.height || 0,
        ...diagramNotes.map((note) => note.y + note.height + 48),
      ),
    }),
    [diagramNotes, layout?.height, layout?.width],
  );
  const snapshotRelationsByName = useMemo(
    () =>
      new Map(
        (snapshot?.relations || []).map((relation) => [
          relation.name,
          relation,
        ]),
      ),
    [snapshot],
  );
  const fullEdgeIndexesByRelation = useMemo(
    () => buildSchemaDiagramEdgeIndex(fullLayout?.edges || []),
    [fullLayout?.edges],
  );

  return {
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
  };
}
