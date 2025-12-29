/**
 * Design Tokens - 设计系统的核心常量
 *
 * 这个文件定义了整个应用的设计规范，包括颜色、间距、字体等。
 * 所有 CVA 变体都应该引用这些 tokens，而不是硬编码值。
 */

// ============================================================================
// 颜色系统 (Color System)
// ============================================================================

export const colors = {
  // 背景色
  background: {
    primary: "#131313", // 主背景
    secondary: "#1a1a1a", // 次级背景（AppBar, TitleBar）
    tertiary: "#1e1e1e", // 三级背景（编辑器区域）
    elevated: "#2a2a2a", // 悬停/激活状态
  },

  // 边框色
  border: {
    default: "#333", // 默认边框
    subtle: "#111", // 更暗的边框
    divider: "#444", // 分割线
  },

  // 文字色
  text: {
    primary: "#e5e5e5", // 主要文字（gray-200）
    secondary: "#9ca3af", // 次要文字（gray-400）
    tertiary: "#6b7280", // 三级文字（gray-500）
    muted: "#4b5563", // 弱化文字（gray-600）
    white: "#ffffff", // 纯白
  },

  // 品牌色/强调色
  accent: {
    orange: "#f97316", // 主题橙色
    orangeHover: "#ea580c", // 橙色悬停
    red: "#ef4444", // 错误/关闭
    redHover: "#dc2626", // 红色悬停
    green: "#10b981", // 成功
    blue: "#3b82f6", // 信息
  },
} as const;

// ============================================================================
// 间距系统 (Spacing System)
// ============================================================================

export const spacing = {
  // 组件高度
  titleBar: "2rem", // 32px - TitleBar 高度
  appBar: "3rem", // 48px - AppBar 高度
  statusBar: "1.75rem", // 28px - StatusBar 高度
  tabBar: "2.25rem", // 36px - TabBar 高度

  // 侧边栏宽度
  activityBar: "3rem", // 48px - ActivityBar 宽度
  sidebarMin: "280px", // 侧边栏最小宽度
  sidebarMax: "600px", // 侧边栏最大宽度

  // 通用间距
  xs: "0.25rem", // 4px
  sm: "0.5rem", // 8px
  md: "0.75rem", // 12px
  lg: "1rem", // 16px
  xl: "1.5rem", // 24px
} as const;

// ============================================================================
// 字体系统 (Typography System)
// ============================================================================

export const typography = {
  // 字体族
  fontFamily: {
    sans: "Inter, system-ui, -apple-system, sans-serif",
    mono: '"JetBrains Mono", "Fira Code", Consolas, monospace',
  },

  // 字号
  fontSize: {
    xs: "0.625rem", // 10px
    sm: "0.75rem", // 12px
    base: "0.875rem", // 14px
    lg: "1rem", // 16px
    xl: "1.125rem", // 18px
  },

  // 字重
  fontWeight: {
    normal: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },

  // 字符间距
  letterSpacing: {
    tight: "-0.025em",
    normal: "0",
    wide: "0.025em",
    wider: "0.05em",
    widest: "0.1em",
  },
} as const;

// ============================================================================
// 动画系统 (Animation System)
// ============================================================================

export const animation = {
  // 过渡时间
  duration: {
    fast: "150ms",
    normal: "200ms",
    slow: "300ms",
  },

  // 缓动函数
  easing: {
    default: "cubic-bezier(0.4, 0, 0.2, 1)",
    in: "cubic-bezier(0.4, 0, 1, 1)",
    out: "cubic-bezier(0, 0, 0.2, 1)",
    inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  },
} as const;

// ============================================================================
// Z-Index 层级系统
// ============================================================================

export const zIndex = {
  base: 0,
  dropdown: 10,
  overlay: 20,
  modal: 30,
  popover: 40,
  tooltip: 50,
} as const;

// ============================================================================
// 导出类型（用于 TypeScript 类型推断）
// ============================================================================

export type Colors = typeof colors;
export type Spacing = typeof spacing;
export type Typography = typeof typography;
export type Animation = typeof animation;
export type ZIndex = typeof zIndex;
