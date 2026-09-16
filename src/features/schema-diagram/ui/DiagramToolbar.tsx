import type { SchemaStructuredDraftForeignKeySeed } from "@/components/workspace/SchemaStructuredDraftDialog";
import {
  MAX_ZOOM,
  MIN_ZOOM,
} from "@/features/schema-diagram/model/diagramConstants";
import { loadSchemaStructuredDraftDialog } from "@/features/schema-diagram/ui/DiagramDrafts";
import type { SchemaDiagramLayout } from "@/lib/schemaDiagram";
import type { SchemaDiagramArea } from "@/lib/schemaDiagramAreas";
import type { SchemaDiagramRasterFormat } from "@/lib/schemaDiagramSvg";
import { cn } from "@/lib/utils";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import {
  Check,
  Crosshair,
  Download,
  FileCode2,
  GitCompareArrows,
  KeyRound,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Search,
  StickyNote,
  Table2,
  X,
} from "lucide-react";

interface DiagramToolbarContext {
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  keysOnly: boolean;
  setKeysOnly: React.Dispatch<React.SetStateAction<boolean>>;
  relationScope: "all" | "related" | "area";
  setRelationScope: React.Dispatch<
    React.SetStateAction<"all" | "related" | "area">
  >;
  selectedName: string | null;
  selectedArea: SchemaDiagramArea | null;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  zoom: number;
  fitDiagram: () => void;
  exportScope: "filtered" | "full";
  setExportScope: React.Dispatch<React.SetStateAction<"filtered" | "full">>;
  exportBackground: "dark" | "light" | "transparent";
  setExportBackground: React.Dispatch<
    React.SetStateAction<"dark" | "light" | "transparent">
  >;
  exportSvg: () => void;
  layout: SchemaDiagramLayout;
  diagramNotes: SchemaDiagramNote[];
  exportRaster: (format: SchemaDiagramRasterFormat) => Promise<void>;
  isRasterizing: boolean;
  exportDbml: () => void;
  setForeignKeySeed: React.Dispatch<
    React.SetStateAction<SchemaStructuredDraftForeignKeySeed | null>
  >;
  setStructuredDraftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  canvasPersistenceReady: boolean;
  beginCreateNote: () => void;
  setDbmlDraftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setInspectorCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  inspectorCollapsed: boolean;
  selectedIsHidden: boolean;
  focusRelatedRelation: (relationName: string) => void;
}

export function DiagramToolbar({
  query,
  setQuery,
  keysOnly,
  setKeysOnly,
  relationScope,
  setRelationScope,
  selectedName,
  selectedArea,
  setZoom,
  zoom,
  fitDiagram,
  exportScope,
  setExportScope,
  exportBackground,
  setExportBackground,
  exportSvg,
  layout,
  diagramNotes,
  exportRaster,
  isRasterizing,
  exportDbml,
  setForeignKeySeed,
  setStructuredDraftOpen,
  canvasPersistenceReady,
  beginCreateNote,
  setDbmlDraftOpen,
  setInspectorCollapsed,
  inspectorCollapsed,
  selectedIsHidden,
  focusRelatedRelation,
}: DiagramToolbarContext) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.62)] px-3">
      <label className="relative block w-56">
        <Search
          size={11}
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 wb-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find relation or column"
          className="h-6 w-full rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] pl-6 pr-6 text-[9px] outline-none placeholder:text-[hsl(var(--wb-text-muted)/0.65)] focus:border-[hsl(var(--wb-accent)/0.55)]"
        />
        {query && (
          <button
            type="button"
            className="absolute right-1 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center wb-muted hover:text-[hsl(var(--wb-text))]"
            onClick={() => setQuery("")}
            aria-label="Clear diagram search"
          >
            <X size={10} />
          </button>
        )}
      </label>
      <button
        type="button"
        className={cn(
          "wb-text-button h-6 gap-1.5 px-2 text-[9px]",
          keysOnly &&
            "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]",
        )}
        onClick={() => setKeysOnly((current) => !current)}
        aria-pressed={keysOnly}
      >
        {keysOnly ? <Check size={10} /> : <KeyRound size={10} />}
        Keys only
      </button>
      <select
        aria-label="Diagram relation scope"
        value={relationScope}
        onChange={(event) =>
          setRelationScope(event.target.value as "all" | "related" | "area")
        }
        className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 text-[8px] outline-none focus:border-[hsl(var(--wb-accent)/0.55)]"
      >
        <option value="all">All relations</option>
        <option value="related" disabled={!selectedName}>
          Selected + related
        </option>
        <option value="area" disabled={!selectedArea}>
          Selected area
        </option>
      </select>
      <span className="h-4 w-px bg-[hsl(var(--wb-border-subtle))]" />
      <button
        type="button"
        className="wb-icon-button h-6 w-6"
        onClick={() => setZoom((current) => Math.max(MIN_ZOOM, current - 0.1))}
        aria-label="Zoom out"
      >
        <Minus size={11} />
      </button>
      <button
        type="button"
        className="wb-text-button h-6 min-w-12 px-1.5 font-mono text-[9px]"
        onClick={() => setZoom(1)}
        title="Reset zoom"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="wb-icon-button h-6 w-6"
        onClick={() => setZoom((current) => Math.min(MAX_ZOOM, current + 0.1))}
        aria-label="Zoom in"
      >
        <Plus size={11} />
      </button>
      <button
        type="button"
        className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
        onClick={fitDiagram}
      >
        <Crosshair size={10} /> Fit
      </button>
      <select
        aria-label="Diagram export scope"
        value={exportScope}
        onChange={(event) =>
          setExportScope(event.target.value as "filtered" | "full")
        }
        className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1 text-[8px] outline-none"
      >
        <option value="filtered">Filtered</option>
        <option value="full">Full</option>
      </select>
      <select
        aria-label="Diagram export background"
        value={exportBackground}
        onChange={(event) =>
          setExportBackground(
            event.target.value as "dark" | "light" | "transparent",
          )
        }
        className="h-6 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1 text-[8px] outline-none"
      >
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="transparent">Transparent</option>
      </select>
      <button
        type="button"
        className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
        onClick={exportSvg}
        disabled={layout.nodes.length === 0 && diagramNotes.length === 0}
        title="Export the current filtered diagram as SVG"
      >
        <Download size={10} /> SVG
      </button>
      <button
        type="button"
        className="wb-text-button h-6 px-2 text-[9px]"
        onClick={() => void exportRaster("png")}
        disabled={
          (layout.nodes.length === 0 && diagramNotes.length === 0) ||
          isRasterizing
        }
      >
        PNG
      </button>
      <button
        type="button"
        className="wb-text-button h-6 px-2 text-[9px]"
        onClick={() => void exportRaster("jpeg")}
        disabled={
          (layout.nodes.length === 0 && diagramNotes.length === 0) ||
          isRasterizing
        }
        title={
          exportBackground === "transparent"
            ? "JPEG uses a white background"
            : undefined
        }
      >
        JPG
      </button>
      <button
        type="button"
        className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
        onClick={exportDbml}
        title="Export the complete snapshot as review-only DBML"
      >
        <FileCode2 size={10} /> DBML
      </button>
      <button
        type="button"
        className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
        onClick={() => {
          setForeignKeySeed(null);
          setStructuredDraftOpen(true);
        }}
        onPointerEnter={() => void loadSchemaStructuredDraftDialog()}
        onFocus={() => void loadSchemaStructuredDraftDialog()}
        title="Edit tables, columns, indexes and constraints in a local review-only draft"
      >
        <Table2 size={10} /> Structure
      </button>
      <button
        type="button"
        className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
        disabled={!canvasPersistenceReady}
        onClick={beginCreateNote}
        title="Add a project-persisted annotation to the diagram canvas"
      >
        <StickyNote size={10} /> Note
      </button>
      <button
        type="button"
        className="wb-text-button h-6 gap-1.5 px-2 text-[9px]"
        onClick={() => setDbmlDraftOpen(true)}
        title="Edit a local DBML draft and open a review-only schema diff"
      >
        <GitCompareArrows size={10} /> DBML Draft
      </button>
      <button
        type="button"
        className="wb-icon-button h-6 w-6"
        onClick={() => setInspectorCollapsed((current) => !current)}
        aria-label={
          inspectorCollapsed
            ? "Show diagram inspector"
            : "Hide diagram inspector"
        }
        aria-pressed={!inspectorCollapsed}
      >
        {inspectorCollapsed ? (
          <PanelRightOpen size={11} />
        ) : (
          <PanelRightClose size={11} />
        )}
      </button>
      {selectedIsHidden && selectedName && (
        <button
          type="button"
          className="ml-auto wb-text-button h-6 gap-1.5 px-2 text-[9px] text-amber-200"
          onClick={() => focusRelatedRelation(selectedName)}
          title="Clear search/scope filters and center the selected relation"
        >
          <Crosshair size={10} /> Show hidden selection
        </button>
      )}
      <span
        className={cn("text-[9px] wb-muted", !selectedIsHidden && "ml-auto")}
      >
        {layout.nodes.length}/{layout.totalRelationCount} visible · double-click
        to reveal
      </span>
    </div>
  );
}
