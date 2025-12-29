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
        ghost: "text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]",
        danger: "text-gray-500 hover:text-red-500 hover:bg-red-500/10",
        active: "text-gray-300 bg-[#2a2a2a]",
        orange: "text-orange-500 hover:text-orange-400 hover:bg-orange-500/10",
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
        default: "text-gray-300 hover:bg-[#2a2a2a]",
        primary: "bg-orange-500 text-white hover:bg-orange-600",
        secondary: "bg-[#2a2a2a] text-gray-300 hover:bg-[#333]",
        outline: "border border-[#333] text-gray-300 hover:bg-[#2a2a2a]",
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
        true: "border-orange-500 text-gray-200 bg-[#1e1e1e]",
        false:
          "border-transparent text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]",
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
