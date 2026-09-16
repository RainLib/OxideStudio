import { formatTimestamp } from "@/features/schema-diagram/model/diagramPresentation";
import type { SchemaDiagramLayout } from "@/lib/schemaDiagram";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { AlertTriangle, ExternalLink, Network } from "lucide-react";

interface DiagramHeaderContext {
  snapshot: SchemaSnapshot;
  layout: SchemaDiagramLayout;
  selectedName: string | null;
  revealRelation: (relationName: string) => Promise<void>;
}

export function DiagramHeader({
  snapshot,
  layout,
  selectedName,
  revealRelation,
}: DiagramHeaderContext) {
  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] bg-[hsl(var(--wb-active-strong))] text-violet-300">
            <Network size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-semibold">
              <span className="truncate">{snapshot.connectionName}</span>
              {snapshot.databaseName && (
                <>
                  <span className="font-normal wb-muted">/</span>
                  <span className="truncate">{snapshot.databaseName}</span>
                </>
              )}
              <span className="font-normal wb-muted">/</span>
              <span className="truncate font-mono">{snapshot.schemaName}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] wb-muted">
              <span>{layout.totalRelationCount} relations</span>
              <span>·</span>
              <span>{layout.totalRelationshipCount} foreign keys</span>
              {layout.externalRelationshipCount > 0 && (
                <>
                  <span>·</span>
                  <span>{layout.externalRelationshipCount} external</span>
                </>
              )}
              <span>·</span>
              <span>{formatTimestamp(snapshot.capturedAt)}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="wb-text-button h-7 gap-1.5 px-2.5 text-[10px]"
          disabled={!selectedName}
          onClick={() => selectedName && void revealRelation(selectedName)}
        >
          <ExternalLink size={11} /> Reveal selected
        </button>
      </header>

      {snapshot.warnings.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-warning)/0.28)] bg-[hsl(var(--wb-warning)/0.08)] px-3 py-1.5 text-[9px] text-[hsl(var(--wb-text))]"
          title={snapshot.warnings.join("\n")}
        >
          <AlertTriangle
            size={11}
            className="shrink-0 text-[hsl(var(--wb-warning))]"
          />
          <span className="truncate">
            Diagram opened with {snapshot.warnings.length} metadata warning
            {snapshot.warnings.length === 1 ? "" : "s"}. Unavailable details are
            shown as relation shells.
          </span>
        </div>
      )}
    </>
  );
}
