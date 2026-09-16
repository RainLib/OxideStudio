import {
  cssHslVar,
  cssHslVarAlpha,
  drawTruncatedHeaderText,
} from "@/features/data-grid/model/gridPresentation";
import { compactResultColumnType } from "@/features/data-grid/model/resultColumnType";
import type { QueryResultGridState } from "@/features/workspace-tabs/model/types";
import type { dataGridMetrics } from "@/lib/dataGridView";
import type { ColumnInfo } from "@/services/tauri/types/schemaCatalog";
import { useTheme } from "@/theme/useTheme";
import { Theme, type DrawHeaderCallback } from "@glideapps/glide-data-grid";

import { useCallback, useMemo } from "react";

interface GridThemeOptions {
  viewMetrics: ReturnType<typeof dataGridMetrics>;
  gridScale: number;
  isTransposed: boolean;
  reserveHeaderTypeLine: boolean;
  reserveHeaderCommentLine: boolean;
  visibleHeaderMetadata: {
    name: string;
    type: string | undefined;
    comment: string;
    metadata: ColumnInfo | undefined;
  }[];
  showTypeIcons: boolean;
  gridState: QueryResultGridState | undefined;
}

export function useGridTheme({
  viewMetrics,
  gridScale,
  isTransposed,
  reserveHeaderTypeLine,
  reserveHeaderCommentLine,
  visibleHeaderMetadata,
  showTypeIcons,
  gridState,
}: GridThemeOptions) {
  const { mode } = useTheme();
  const gridFontSize = viewMetrics.fontSize;
  // Keep the canvas palette aligned with the workbench CSS tokens.
  const gridTheme: Partial<Theme> = useMemo(
    () => ({
      accentColor: cssHslVar(
        "--wb-accent",
        mode === "dark" ? "#75a7ff" : "#2f65d7",
      ),
      accentLight: cssHslVarAlpha(
        "--wb-accent",
        mode === "dark" ? 0.24 : 0.16,
        mode === "dark"
          ? "rgba(91, 137, 214, 0.24)"
          : "rgba(47, 101, 215, 0.16)",
      ),

      bgCell: cssHslVar("--wb-grid", mode === "dark" ? "#1e1f22" : "#ffffff"),
      bgCellMedium: cssHslVar(
        "--wb-editor",
        mode === "dark" ? "#1f2125" : "#f5f7fb",
      ),

      bgHeader: cssHslVar(
        "--wb-grid-header",
        mode === "dark" ? "#24272d" : "#eef2f8",
      ),
      bgHeaderHasFocus: cssHslVarAlpha(
        "--wb-active-strong",
        mode === "dark" ? 0.88 : 0.82,
        mode === "dark" ? "#2d3a56" : "#dfe8f7",
      ),
      bgHeaderHovered: cssHslVar(
        "--wb-hover",
        mode === "dark" ? "#303846" : "#d8e3f5",
      ),

      textHeader: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#aeb7c8" : "#4b5565",
      ),
      textGroupHeader: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#828b9b" : "#7a8393",
      ),
      textDark: cssHslVar("--wb-text", mode === "dark" ? "#d9dee8" : "#111827"),
      textMedium: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#a7afbd" : "#596274",
      ),
      textLight: cssHslVarAlpha(
        "--wb-text-muted",
        mode === "dark" ? 0.72 : 0.78,
        mode === "dark" ? "#7a8393" : "#8a93a3",
      ),
      textBubble: cssHslVar(
        "--wb-text",
        mode === "dark" ? "#d9dee8" : "#111827",
      ),

      borderColor: cssHslVar(
        "--wb-border-subtle",
        mode === "dark" ? "#343943" : "#dce3ee",
      ),
      drilldownBorder: cssHslVar(
        "--wb-border-subtle",
        mode === "dark" ? "#343943" : "#dce3ee",
      ),

      linkColor: cssHslVar(
        "--wb-accent",
        mode === "dark" ? "#75a7ff" : "#2f65d7",
      ),

      headerFontStyle: `600 ${gridFontSize}px`,
      baseFontStyle: `${gridFontSize}px`,
      fontFamily: "Inter, system-ui, sans-serif",
      editorFontSize: `${gridFontSize}px`,
      lineHeight: 1.45,

      bgIconHeader: cssHslVar(
        "--wb-editor",
        mode === "dark" ? "#202328" : "#f7f9fc",
      ),
      fgIconHeader: cssHslVar(
        "--wb-text-muted",
        mode === "dark" ? "#aeb7c8" : "#596274",
      ),
      bgBubble: cssHslVar(
        "--wb-panel-raised",
        mode === "dark" ? "#1e1f22" : "#ffffff",
      ),
      bgBubbleSelected: "transparent",

      cellHorizontalPadding: Math.max(8, Math.round(10 * gridScale)),
      cellVerticalPadding: Math.max(4, Math.round(5 * gridScale)),
    }),
    [gridFontSize, gridScale, mode],
  );
  const headerIndexPalette = useMemo(
    () => ({
      primaryBackground: cssHslVarAlpha(
        "--wb-warning",
        0.2,
        "rgba(245, 158, 11, 0.2)",
      ),
      primaryForeground: cssHslVar("--wb-warning", "#d97706"),
      indexBackground: cssHslVarAlpha(
        "--wb-accent",
        0.18,
        "rgba(59, 130, 246, 0.18)",
      ),
      indexForeground: cssHslVar("--wb-accent", "#3b82f6"),
    }),
    [mode],
  );
  const drawColumnHeader = useCallback<DrawHeaderCallback>(
    (args, drawContent) => {
      if (
        isTransposed ||
        (!reserveHeaderTypeLine && !reserveHeaderCommentLine)
      ) {
        drawContent();
        return;
      }
      const metadata = visibleHeaderMetadata[args.columnIndex];
      if (!metadata) {
        drawContent();
        return;
      }

      const { ctx, rect, theme, column, isSelected, isHovered } = args;
      const background = isSelected
        ? theme.bgHeaderHasFocus
        : isHovered
          ? theme.bgHeaderHovered
          : theme.bgHeader;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
      ctx.clip();
      ctx.fillStyle = background;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = theme.borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.width - 0.5, rect.y);
      ctx.lineTo(rect.x + rect.width - 0.5, rect.y + rect.height);
      ctx.moveTo(rect.x, rect.y + rect.height - 0.5);
      ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 0.5);
      ctx.stroke();

      const padding = Math.max(8, Math.round(8 * gridScale));
      const actionWidth = column.hasMenu
        ? Math.max(18, Math.round(20 * gridScale))
        : 0;
      let textX = rect.x + padding;
      const textWidth = Math.max(0, rect.width - padding * 2 - actionWidth);
      const indexKind = metadata.metadata?.is_primary_key
        ? "PK"
        : metadata.metadata?.is_unique
          ? "U"
          : metadata.metadata?.is_indexed
            ? "I"
            : "";
      if (showTypeIcons && indexKind) {
        ctx.font = `600 ${Math.max(8, Math.round(9 * gridScale))}px Inter, system-ui, sans-serif`;
        const badgeWidth = Math.ceil(
          ctx.measureText(indexKind).width + 7 * gridScale,
        );
        const badgeHeight = Math.max(13, Math.round(14 * gridScale));
        const badgeY = rect.y + Math.max(4, Math.round(5 * gridScale));
        ctx.fillStyle =
          indexKind === "PK"
            ? headerIndexPalette.primaryBackground
            : headerIndexPalette.indexBackground;
        ctx.fillRect(textX, badgeY, badgeWidth, badgeHeight);
        ctx.fillStyle =
          indexKind === "PK"
            ? headerIndexPalette.primaryForeground
            : headerIndexPalette.indexForeground;
        ctx.textBaseline = "middle";
        ctx.fillText(
          indexKind,
          textX + Math.round(3.5 * gridScale),
          badgeY + badgeHeight / 2,
        );
        textX += badgeWidth + Math.max(5, Math.round(6 * gridScale));
      }

      const sorted = gridState?.sortColumn === String(column.id);
      const sortMark = sorted
        ? gridState?.sortDirection === "desc"
          ? " ↓"
          : " ↑"
        : "";
      ctx.font = `600 ${gridFontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = theme.textHeader;
      ctx.textBaseline = "alphabetic";
      const nameBaseline = rect.y + Math.max(15, Math.round(16 * gridScale));
      drawTruncatedHeaderText(
        ctx,
        `${metadata.name}${sortMark}`,
        textX,
        nameBaseline,
        Math.max(0, textWidth - (textX - rect.x - padding)),
      );

      let detailBaseline = nameBaseline;
      if (reserveHeaderTypeLine) {
        detailBaseline += Math.max(12, Math.round(13 * gridScale));
        ctx.font = `500 ${Math.max(9, gridFontSize - 2)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = theme.textMedium;
        drawTruncatedHeaderText(
          ctx,
          metadata.type ? compactResultColumnType(metadata.type) : "",
          textX,
          detailBaseline,
          Math.max(0, textWidth - (textX - rect.x - padding)),
        );
      }
      if (reserveHeaderCommentLine) {
        detailBaseline += Math.max(11, Math.round(12 * gridScale));
        ctx.font = `400 ${Math.max(9, gridFontSize - 2)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = theme.textLight;
        drawTruncatedHeaderText(
          ctx,
          metadata.comment,
          textX,
          detailBaseline,
          Math.max(0, textWidth - (textX - rect.x - padding)),
        );
      }

      if (column.hasMenu) {
        ctx.font = `600 ${Math.max(12, Math.round(13 * gridScale))}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = theme.textMedium;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "⋮",
          rect.x + rect.width - actionWidth / 2,
          rect.y + rect.height / 2,
        );
      }
      ctx.restore();
    },
    [
      gridFontSize,
      gridScale,
      gridState?.sortColumn,
      gridState?.sortDirection,
      headerIndexPalette,
      isTransposed,
      reserveHeaderCommentLine,
      reserveHeaderTypeLine,
      showTypeIcons,
      visibleHeaderMetadata,
    ],
  );
  const dataGridHeaderHeight = Math.max(
    viewMetrics.headerHeight,
    Math.round(
      (27 +
        (reserveHeaderTypeLine ? 13 : 0) +
        (reserveHeaderCommentLine ? 12 : 0)) *
        gridScale,
    ),
  );

  return { drawColumnHeader, gridTheme, dataGridHeaderHeight };
}
