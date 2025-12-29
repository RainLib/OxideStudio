import { cva, type VariantProps } from "class-variance-authority";

/**
 * 容器变体 - 定义各种布局容器的样式
 */
export const containerVariants = cva("flex", {
  variants: {
    direction: {
      row: "flex-row",
      col: "flex-col",
    },
    layout: {
      // 全屏容器（用于页面根元素）
      fullscreen: "h-screen w-screen overflow-hidden",

      // Workspace 主容器
      workspace:
        "h-screen w-screen flex-col bg-background-primary text-foreground font-sans overflow-hidden",

      // Connection 页面容器
      connection:
        "flex-col h-screen w-full bg-background-primary text-foreground overflow-hidden",

      // 内容区（自适应）
      content: "flex-1 min-w-0 min-h-0",

      // 水平内容区
      contentRow: "flex-1 flex-row min-w-0",

      // 垂直内容区
      contentCol: "flex-1 flex-col min-h-0",
    },
    align: {
      start: "items-start",
      center: "items-center",
      end: "items-end",
      stretch: "items-stretch",
    },
    justify: {
      start: "justify-start",
      center: "justify-center",
      end: "justify-end",
      between: "justify-between",
    },
    gap: {
      none: "gap-0",
      xs: "gap-1",
      sm: "gap-2",
      md: "gap-3",
      lg: "gap-4",
    },
  },
  defaultVariants: {
    direction: "row",
    align: "stretch",
    justify: "start",
    gap: "none",
  },
});

/**
 * 面板变体 - 定义各种面板的样式
 */
export const panelVariants = cva("flex shrink-0", {
  variants: {
    side: {
      left: "border-r border-border-subtle",
      right: "border-l border-border-subtle",
      top: "border-b border-border",
      bottom: "border-t border-border",
    },
    background: {
      primary: "bg-background-primary",
      secondary: "bg-background-secondary",
      tertiary: "bg-background-tertiary",
    },
    size: {
      titleBar: "h-8", // 32px
      appBar: "h-12", // 48px
      statusBar: "h-7", // 28px
      activityBar: "w-12", // 48px
      sidebar: "w-[280px]", // 自定义宽度
    },
  },
  defaultVariants: {
    background: "secondary",
  },
});

/**
 * 分割线变体
 */
export const dividerVariants = cva("", {
  variants: {
    orientation: {
      horizontal: "h-px w-full",
      vertical: "w-px h-full",
    },
    color: {
      default: "bg-border",
      subtle: "bg-border-subtle",
      divider: "bg-border-divider",
    },
    spacing: {
      none: "",
      xs: "mx-1",
      sm: "mx-2",
      md: "mx-3",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
    color: "default",
    spacing: "none",
  },
});

/**
 * 可拖拽区域变体
 */
export const draggableRegionVariants = cva("select-none", {
  variants: {
    cursor: {
      default: "",
      move: "cursor-move",
      grab: "cursor-grab active:cursor-grabbing",
      colResize: "cursor-col-resize",
      rowResize: "cursor-row-resize",
    },
  },
  defaultVariants: {
    cursor: "default",
  },
});

// ============================================================================
// TypeScript 类型导出
// ============================================================================

export type ContainerVariants = VariantProps<typeof containerVariants>;
export type PanelVariants = VariantProps<typeof panelVariants>;
export type DividerVariants = VariantProps<typeof dividerVariants>;
export type DraggableRegionVariants = VariantProps<
  typeof draggableRegionVariants
>;
