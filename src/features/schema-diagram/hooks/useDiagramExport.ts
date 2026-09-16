import { serializeSchemaSnapshotToDbml } from "@/features/schema-diff/model/schemaDbml";
import { downloadBlob, downloadText } from "@/lib/exportUtils";
import type { SchemaDiagramLayout } from "@/lib/schemaDiagram";
import {
  rasterizeSchemaDiagramSvg,
  schemaDiagramSvgSize,
  serializeSchemaDiagramToSvg,
  type SchemaDiagramRasterFormat,
} from "@/lib/schemaDiagramSvg";
import type { SchemaDiagramNote } from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types/schemaDiff";
import { useCallback, useState } from "react";

interface UseDiagramExportContext {
  fullLayout: SchemaDiagramLayout | null;
  layout: SchemaDiagramLayout | null;
  snapshot: SchemaSnapshot | undefined;
  diagramNotes: SchemaDiagramNote[];
}

export function useDiagramExport({
  fullLayout,
  layout,
  snapshot,
  diagramNotes,
}: UseDiagramExportContext) {
  const [exportScope, setExportScope] = useState<"filtered" | "full">(
    "filtered",
  );
  const [exportBackground, setExportBackground] = useState<
    "dark" | "light" | "transparent"
  >("dark");
  const [isRasterizing, setIsRasterizing] = useState(false);

  const exportSvg = useCallback(() => {
    const exportLayout = exportScope === "full" ? fullLayout : layout;
    if (!snapshot || !exportLayout) return;
    const basename =
      `${snapshot.connectionName}-${snapshot.schemaName}-diagram`
        .replace(/[^A-Za-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "schema-diagram";
    downloadText(
      serializeSchemaDiagramToSvg(exportLayout, {
        title: `${snapshot.connectionName} / ${snapshot.schemaName}`,
        background:
          exportBackground === "dark"
            ? "#11151c"
            : exportBackground === "light"
              ? "#ffffff"
              : "transparent",
        annotations: diagramNotes,
      }),
      `${basename}.svg`,
      "image/svg+xml;charset=utf-8",
    );
  }, [
    diagramNotes,
    exportBackground,
    exportScope,
    fullLayout,
    layout,
    snapshot,
  ]);

  const exportRaster = useCallback(
    async (format: SchemaDiagramRasterFormat) => {
      const exportLayout = exportScope === "full" ? fullLayout : layout;
      if (!snapshot || !exportLayout || isRasterizing) return;
      const basename =
        `${snapshot.connectionName}-${snapshot.schemaName}-diagram`
          .replace(/[^A-Za-z0-9._-]+/gu, "-")
          .replace(/^-+|-+$/gu, "") || "schema-diagram";
      const background =
        format === "jpeg" && exportBackground === "transparent"
          ? "#ffffff"
          : exportBackground === "dark"
            ? "#11151c"
            : exportBackground === "light"
              ? "#ffffff"
              : "transparent";
      setIsRasterizing(true);
      try {
        const svg = serializeSchemaDiagramToSvg(exportLayout, {
          title: `${snapshot.connectionName} / ${snapshot.schemaName}`,
          background,
          annotations: diagramNotes,
        });
        const exportSize = schemaDiagramSvgSize(exportLayout, diagramNotes);
        const blob = await rasterizeSchemaDiagramSvg(
          svg,
          exportSize.width,
          exportSize.height,
          format,
        );
        downloadBlob(blob, `${basename}.${format === "jpeg" ? "jpg" : "png"}`);
      } finally {
        setIsRasterizing(false);
      }
    },
    [
      diagramNotes,
      exportBackground,
      exportScope,
      fullLayout,
      isRasterizing,
      layout,
      snapshot,
    ],
  );

  const exportDbml = useCallback(() => {
    if (!snapshot) return;
    const basename =
      `${snapshot.connectionName}-${snapshot.schemaName}-schema`
        .replace(/[^A-Za-z0-9._-]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || "schema";
    const artifact = serializeSchemaSnapshotToDbml(snapshot);
    downloadText(
      artifact.content,
      `${basename}.dbml`,
      "text/plain;charset=utf-8",
    );
  }, [snapshot]);

  return {
    exportScope,
    setExportScope,
    exportBackground,
    setExportBackground,
    isRasterizing,
    exportSvg,
    exportRaster,
    exportDbml,
  };
}
