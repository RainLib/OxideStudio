import { cva, type VariantProps } from "class-variance-authority";

/**
 * 侧边栏变体 - 用于左侧/右侧面板
 */
export const sidebarVariants = cva("flex flex-col shrink-0", {
  variants: {
    side: {
      left: "border-r border-border-subtle",
      right: "border-l border-border-subtle",
    },
    background: {
      primary: "bg-background-primary",
      secondary: "bg-background-secondary",
      tertiary: "bg-background-tertiary",
    },
    collapsible: {
      true: "transition-all duration-200",
      false: "",
    },
  },
  defaultVariants: {
    side: "left",
    background: "secondary",
    collapsible: false,
  },
});

/**
 * Activity Bar 变体 - 垂直导航栏
 */
export const activityBarVariants = cva(
  "flex flex-col items-center gap-1 py-2 shrink-0 bg-background-primary border-r border-border-subtle",
  {
    variants: {
      width: {
        default: "w-12",
        compact: "w-10",
        wide: "w-14",
      },
    },
    defaultVariants: {
      width: "default",
    },
  }
);

/**
 * Activity Bar Item 变体 - 导航栏中的按钮
 */
export const activityBarItemVariants = cva(
  "flex items-center justify-center w-10 h-10 rounded transition-colors cursor-pointer",
  {
    variants: {
      active: {
        true: "text-foreground bg-background-elevated border-l-2 border-primary",
        false:
          "text-muted-foreground hover:text-foreground hover:bg-background-tertiary",
      },
    },
    defaultVariants: {
      active: false,
    },
  }
);

/**
 * 状态栏变体 - 底部状态栏
 */
export const statusBarVariants = cva(
  "flex items-center px-3 shrink-0 border-t",
  {
    variants: {
      type: {
        editor: "h-7 bg-background-secondary border-border justify-between",
        table: "h-9 bg-background-tertiary border-border gap-2",
      },
      position: {
        bottom: "border-t",
        top: "border-b",
      },
    },
    defaultVariants: {
      type: "editor",
      position: "bottom",
    },
  }
);

/**
 * 标签栏变体 - 顶部标签栏
 */
export const tabBarVariants = cva(
  "flex items-center border-b border-border bg-background-tertiary shrink-0",
  {
    variants: {
      size: {
        sm: "h-8",
        md: "h-9",
        lg: "h-10",
      },
      scrollable: {
        true: "overflow-x-auto",
        false: "overflow-hidden",
      },
    },
    defaultVariants: {
      size: "md",
      scrollable: true,
    },
  }
);

/**
 * 面板头部变体 - 用于侧边栏、右侧面板的标题栏
 */
export const panelHeaderVariants = cva(
  "flex items-center px-3 border-b border-border shrink-0",
  {
    variants: {
      size: {
        sm: "h-7 text-[10px]",
        md: "h-9 text-xs",
        lg: "h-10 text-sm",
      },
      variant: {
        default: "text-muted-foreground font-medium",
        bold: "text-foreground font-bold uppercase tracking-widest",
      },
    },
    defaultVariants: {
      size: "md",
      variant: "default",
    },
  }
);

/**
 * 窗口拖拽区域变体 - 用于 Tauri 窗口拖拽
 */
export const windowDragRegionVariants = cva("select-none", {
  variants: {
    enabled: {
      true: "data-tauri-drag-region",
      false: "",
    },
  },
  defaultVariants: {
    enabled: true,
  },
});

// ============================================================================
// TypeScript 类型导出
// ============================================================================

export type SidebarVariants = VariantProps<typeof sidebarVariants>;
export type ActivityBarVariants = VariantProps<typeof activityBarVariants>;
export type ActivityBarItemVariants = VariantProps<
  typeof activityBarItemVariants
>;
export type StatusBarVariants = VariantProps<typeof statusBarVariants>;
export type TabBarVariants = VariantProps<typeof tabBarVariants>;
export type PanelHeaderVariants = VariantProps<typeof panelHeaderVariants>;
export type WindowDragRegionVariants = VariantProps<
  typeof windowDragRegionVariants
>;
