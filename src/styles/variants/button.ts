import { cva, type VariantProps } from "class-variance-authority";

/**
 * 图标按钮变体 - 用于工具栏、标题栏等场景
 * 专门优化了图标按钮的尺寸和间距
 */
export const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded transition-colors",
  {
    variants: {
      variant: {
        ghost:
          "text-muted-foreground hover:text-foreground hover:bg-background-elevated active:bg-background-elevated/75 active:text-foreground",
        danger:
          "text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:bg-destructive/20 active:text-destructive",
        active:
          "text-foreground bg-background-elevated active:bg-background-elevated/75",
        orange:
          "text-primary hover:text-primary/90 hover:bg-primary/10 active:bg-primary/20",
      },
      size: {
        xs: "h-5 w-5 text-[10px]", // 20px - 超小按钮
        sm: "h-6 w-6 text-xs", // 24px - 小按钮（TitleBar）
        md: "h-8 w-8 text-sm", // 32px - 中等按钮（AppBar）
        lg: "h-10 w-10 text-base", // 40px - 大按钮
      },
      disabled: {
        true: "opacity-50 cursor-not-allowed pointer-events-none",
        false: "cursor-pointer",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
      disabled: false,
    },
  }
);

/**
 * 工具栏按钮变体 - 带文字和图标的按钮
 */
export const toolbarButtonVariants = cva(
  "inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors",
  {
    variants: {
      variant: {
        default:
          "text-foreground hover:bg-background-elevated active:bg-background-elevated/75",
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        secondary:
          "bg-background-elevated text-foreground hover:bg-border active:bg-border/75",
        outline:
          "border border-border text-foreground hover:bg-background-elevated active:bg-background-elevated/75",
      },
      size: {
        sm: "px-2 py-1 text-xs",
        md: "px-3 py-1.5 text-sm",
        lg: "px-4 py-2 text-base",
      },
      disabled: {
        true: "opacity-50 cursor-not-allowed pointer-events-none",
        false: "cursor-pointer",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
      disabled: false,
    },
  }
);

/**
 * 标签按钮变体 - 用于 TabBar 的标签
 */
export const tabButtonVariants = cva(
  "inline-flex items-center gap-2 px-3 py-2 text-sm border-b-2 transition-colors",
  {
    variants: {
      active: {
        true: "border-primary text-foreground bg-background-tertiary",
        false:
          "border-transparent text-muted-foreground hover:text-foreground hover:bg-background-elevated active:bg-background-elevated/75 active:text-foreground",
      },
      closable: {
        true: "",
        false: "",
      },
    },
    defaultVariants: {
      active: false,
      closable: true,
    },
  }
);

/**
 * Close 按钮变体 - 用于关闭标签、对话框等
 */
export const closeButtonVariants = cva(
  "inline-flex items-center justify-center rounded transition-opacity",
  {
    variants: {
      size: {
        sm: "h-4 w-4",
        md: "h-5 w-5",
      },
      visible: {
        always: "opacity-100",
        hover: "opacity-0 group-hover:opacity-100",
      },
    },
    defaultVariants: {
      size: "sm",
      visible: "hover",
    },
  }
);

// ============================================================================
// TypeScript 类型导出
// ============================================================================

export type IconButtonVariants = VariantProps<typeof iconButtonVariants>;
export type ToolbarButtonVariants = VariantProps<typeof toolbarButtonVariants>;
export type TabButtonVariants = VariantProps<typeof tabButtonVariants>;
export type CloseButtonVariants = VariantProps<typeof closeButtonVariants>;
