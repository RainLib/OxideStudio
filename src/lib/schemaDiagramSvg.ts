import {
  diagramColumnOffset,
  type SchemaDiagramLayout,
  type SchemaDiagramNode,
} from "@/lib/schemaDiagram";

export type SchemaDiagramSvgOptions = {
  title?: string;
  background?: string;
};

export type SchemaDiagramRasterFormat = "png" | "jpeg";

export function schemaDiagramRasterSize(
  width: number,
  height: number,
  maxPixels = 24_000_000,
) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(1, Math.sqrt(maxPixels / (safeWidth * safeHeight)));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
    scale,
  };
}

export async function rasterizeSchemaDiagramSvg(
  svg: string,
  width: number,
  height: number,
  format: SchemaDiagramRasterFormat,
) {
  const size = schemaDiagramRasterSize(width, height);
  const source = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("Could not render schema diagram SVG."));
      candidate.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas export is unavailable.");
    if (format === "jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("Could not encode diagram image.")),
        format === "png" ? "image/png" : "image/jpeg",
        format === "png" ? undefined : 0.92,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function edgePath(source: SchemaDiagramNode, target: SchemaDiagramNode) {
  const targetOnRight = target.x > source.x;
  const sourceX = targetOnRight ? source.x + source.width : source.x;
  const targetX = targetOnRight ? target.x : target.x + target.width;
  const middleX = (sourceX + targetX) / 2;
  return { targetOnRight, sourceX, targetX, middleX };
}

/** Serializes the deterministic diagram layout without rasterizing the DOM. */
export function serializeSchemaDiagramToSvg(
  layout: SchemaDiagramLayout,
  options: SchemaDiagramSvgOptions = {},
) {
  const title = options.title || "Database schema diagram";
  const background = options.background || "#11151c";
  const light = /^(?:#fff(?:fff)?|white)$/iu.test(background.trim());
  const palette = light
    ? {
        edge: "#64748b",
        edgePoint: "#475569",
        divider: "#cbd5e1",
        key: "#b45309",
        text: "#0f172a",
        muted: "#475569",
        node: "#ffffff",
        nodeBorder: "#94a3b8",
        header: "#f1f5f9",
        accent: "#6d28d9",
      }
    : {
        edge: "#64748b",
        edgePoint: "#94a3b8",
        divider: "#303846",
        key: "#fbbf24",
        text: "#e5e7eb",
        muted: "#94a3b8",
        node: "#171d27",
        nodeBorder: "#475569",
        header: "#202735",
        accent: "#a78bfa",
      };
  const nodesByName = new Map(
    layout.nodes.map((node) => [node.relationName, node]),
  );
  const edges = layout.edges.flatMap((edge) => {
    const source = nodesByName.get(edge.sourceRelation);
    const target = nodesByName.get(edge.targetRelation);
    if (!source || !target) return [];
    const { targetOnRight, sourceX, targetX, middleX } = edgePath(source, target);
    const sourceY =
      source.y + diagramColumnOffset(source, edge.sourceColumns[0]);
    const targetY =
      target.y + diagramColumnOffset(target, edge.targetColumns[0]);
    const arrow = targetOnRight
      ? `${targetX - 6},${targetY - 4} ${targetX},${targetY} ${
          targetX - 6
        },${targetY + 4}`
      : `${targetX + 6},${targetY - 4} ${targetX},${targetY} ${
          targetX + 6
        },${targetY + 4}`;
    return [
      `<g><title>${xml(edge.constraintName)}</title>`,
      `<path d="M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}" fill="none" stroke="${palette.edge}" stroke-opacity="0.7" stroke-width="1.25"/>`,
      `<circle cx="${sourceX}" cy="${sourceY}" r="2.25" fill="${palette.edgePoint}"/>`,
      `<polyline points="${arrow}" fill="none" stroke="${palette.edgePoint}" stroke-width="1.25"/>`,
      `</g>`,
    ].join("");
  });
  const nodes = layout.nodes.map((node) => {
    const rows = node.columns.map((column, index) => {
      const y = node.y + 38 + index * 21;
      const key = [
        column.primaryKey ? "PK" : "",
        column.foreignKey ? "FK" : "",
      ]
        .filter(Boolean)
        .join("/");
      return [
        `<line x1="${node.x}" y1="${y}" x2="${node.x + node.width}" y2="${y}" stroke="${palette.divider}"/>`,
        `<text x="${node.x + 10}" y="${y + 14}" fill="${palette.key}" font-size="8">${xml(key)}</text>`,
        `<text x="${node.x + 42}" y="${y + 14}" fill="${palette.text}" font-size="9">${xml(column.name)}</text>`,
        `<text x="${node.x + node.width - 10}" y="${y + 14}" fill="${palette.muted}" font-size="8" text-anchor="end">${xml(column.dataType)}${column.nullable ? " ?" : ""}</text>`,
      ].join("");
    });
    const hidden = node.hiddenColumnCount
      ? `<text x="${node.x + 10}" y="${node.y + node.height - 8}" fill="${palette.muted}" font-size="8">+${node.hiddenColumnCount} hidden columns</text>`
      : "";
    return [
      `<g><title>${xml(node.relationName)}</title>`,
      `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="5" fill="${palette.node}" stroke="${palette.nodeBorder}"/>`,
      `<path d="M ${node.x + 5} ${node.y} H ${node.x + node.width - 5} Q ${node.x + node.width} ${node.y} ${node.x + node.width} ${node.y + 5} V ${node.y + 38} H ${node.x} V ${node.y + 5} Q ${node.x} ${node.y} ${node.x + 5} ${node.y}" fill="${palette.header}"/>`,
      `<text x="${node.x + 12}" y="${node.y + 24}" fill="${palette.text}" font-size="11" font-weight="600">${xml(node.relationName)}</text>`,
      `<text x="${node.x + node.width - 10}" y="${node.y + 24}" fill="${palette.accent}" font-size="8" text-anchor="end">${xml(node.objectType || "TABLE")}</text>`,
      rows.join(""),
      hidden,
      `</g>`,
    ].join("");
  });

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-labelledby="diagram-title">`,
    `<title id="diagram-title">${xml(title)}</title>`,
    `<rect width="100%" height="100%" fill="${xml(background)}"/>`,
    `<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">`,
    edges.join(""),
    nodes.join(""),
    `</g></svg>`,
  ].join("");
}
