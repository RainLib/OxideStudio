import { InspectorSection } from "@/features/schema-diagram/ui/InspectorSection";
import type { SchemaDiagramEdge } from "@/lib/schemaDiagram";
import type { SchemaRelationSnapshot } from "@/services/tauri/types/schemaDiff";
import { Columns3, Network, Table2 } from "lucide-react";

interface DiagramInspectorContext {
  selectedRelation: SchemaRelationSnapshot | null;
  relatedEdges: SchemaDiagramEdge[];
  focusRelatedRelation: (relationName: string) => void;
}

export function DiagramInspector({
  selectedRelation,
  relatedEdges,
  focusRelatedRelation,
}: DiagramInspectorContext) {
  return (
    <aside className="min-h-0 overflow-auto border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)]">
      {selectedRelation ? (
        <>
          <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-3">
            <div className="flex items-center gap-2">
              <Table2 size={12} className="text-violet-300" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold">
                {selectedRelation.name}
              </span>
            </div>
            <div className="mt-1 text-[8px] uppercase tracking-[0.12em] wb-muted">
              {selectedRelation.objectType || "relation"} ·{" "}
              {selectedRelation.columns.length} columns
            </div>
          </div>
          <InspectorSection title="Columns" icon={Columns3}>
            {selectedRelation.columns.map((column) => (
              <div
                key={column.name}
                className="flex items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-1.5 text-[9px] last:border-b-0"
              >
                <span className="w-5 shrink-0 font-mono text-[8px] text-amber-300">
                  {column.is_primary_key ? "PK" : ""}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">
                  {column.name}
                </span>
                <span className="max-w-24 truncate font-mono text-[8px] wb-muted">
                  {column.data_type}
                </span>
              </div>
            ))}
          </InspectorSection>
          <InspectorSection
            title={`Relationships ${relatedEdges.length}`}
            icon={Network}
          >
            {relatedEdges.length === 0 ? (
              <div className="px-3 py-2 text-[9px] wb-muted">
                No in-schema foreign keys.
              </div>
            ) : (
              relatedEdges.map((edge) => {
                const outgoing = edge.sourceRelation === selectedRelation.name;
                const other = outgoing
                  ? edge.targetRelation
                  : edge.sourceRelation;
                return (
                  <button
                    type="button"
                    key={edge.id}
                    className="block w-full border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left last:border-b-0 hover:bg-[hsl(var(--wb-hover))]"
                    onClick={() => focusRelatedRelation(other)}
                  >
                    <span className="flex items-center gap-1.5 text-[9px]">
                      <span className="wb-muted">{outgoing ? "→" : "←"}</span>
                      <span className="truncate font-mono">{other}</span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-[8px] wb-muted">
                      {edge.constraintName} · {edge.sourceColumns.join(", ")} →{" "}
                      {edge.targetColumns.join(", ")}
                    </span>
                  </button>
                );
              })
            )}
          </InspectorSection>
        </>
      ) : (
        <div className="flex h-full items-center justify-center px-5 text-center text-[9px] leading-4 wb-muted">
          Select a relation to inspect its columns and foreign keys.
        </div>
      )}
    </aside>
  );
}
