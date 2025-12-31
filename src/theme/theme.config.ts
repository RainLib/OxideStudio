/**
 * 主题配置文件
 * 定义设计系统的所有 design tokens
 */

export type ThemeMode = "light" | "dark" | "system";

/**
 * 颜色系统配置
 */
export interface ThemeColors {
  // 基础颜色
  background: string;
  foreground: string;

  // 卡片颜色
  card: string;
  cardForeground: string;

  // 弹出层颜色
  popover: string;
  popoverForeground: string;

  // 主色调
  primary: string;
  primaryForeground: string;

  // 次要色调
  secondary: string;
  secondaryForeground: string;

  // 柔和色调
  muted: string;
  mutedForeground: string;

  // 强调色调
  accent: string;
  accentForeground: string;

  // 危险/错误色调
  destructive: string;
  destructiveForeground: string;

  // 边框和输入框
  border: string;
  input: string;
  ring: string;
}

/**
 * 间距系统配置
 */
export interface ThemeSpacing {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
  "4xl": string;
}

/**
 * 圆角系统配置
 */
export interface ThemeRadius {
  sm: string;
  md: string;
  lg: string;
  full: string;
}

/**
 * 字体系统配置
 */
export interface ThemeFonts {
  sans: string[];
  mono: string[];
}

/**
 * 完整主题配置
 */
export interface ThemeConfig {
  colors: ThemeColors;
  spacing: ThemeSpacing;
  radius: ThemeRadius;
  fonts: ThemeFonts;
}

/**
 * Light 主题配置
 */
export const lightTheme: ThemeConfig = {
  colors: {
    background: "0 0% 100%",
    foreground: "222.2 84% 4.9%",
    card: "0 0% 100%",
    cardForeground: "222.2 84% 4.9%",
    popover: "0 0% 100%",
    popoverForeground: "222.2 84% 4.9%",
    primary: "222.2 47.4% 11.2%",
    primaryForeground: "210 40% 98%",
    secondary: "210 40% 96.1%",
    secondaryForeground: "222.2 47.4% 11.2%",
    muted: "210 40% 96.1%",
    mutedForeground: "215.4 16.3% 46.9%",
    accent: "210 40% 96.1%",
    accentForeground: "222.2 47.4% 11.2%",
    destructive: "0 84.2% 60.2%",
    destructiveForeground: "210 40% 98%",
    border: "214.3 31.8% 91.4%",
    input: "214.3 31.8% 91.4%",
    ring: "222.2 84% 4.9%",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
    "3xl": "4rem",
    "4xl": "6rem",
  },
  radius: {
    sm: "calc(0.5rem - 4px)",
    md: "calc(0.5rem - 2px)",
    lg: "0.5rem",
    full: "9999px",
  },
  fonts: {
    sans: ["Inter", "Avenir", "Helvetica", "Arial", "sans-serif"],
    mono: ["JetBrains Mono", "Monaco", "Courier New", "monospace"],
  },
};

/**
 * Dark 主题配置
 */
export const darkTheme: ThemeConfig = {
  colors: {
    background: "222.2 84% 4.9%",
    foreground: "210 40% 98%",
    card: "222.2 84% 4.9%",
    cardForeground: "210 40% 98%",
    popover: "222.2 84% 4.9%",
    popoverForeground: "210 40% 98%",
    primary: "210 40% 98%",
    primaryForeground: "222.2 47.4% 11.2%",
    secondary: "217.2 32.6% 17.5%",
    secondaryForeground: "210 40% 98%",
    muted: "217.2 32.6% 17.5%",
    mutedForeground: "215 20.2% 65.1%",
    accent: "217.2 32.6% 17.5%",
    accentForeground: "210 40% 98%",
    destructive: "0 62.8% 30.6%",
    destructiveForeground: "210 40% 98%",
    border: "217.2 32.6% 17.5%",
    input: "217.2 32.6% 17.5%",
    ring: "212.7 26.8% 83.9%",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
    "3xl": "4rem",
    "4xl": "6rem",
  },
  radius: {
    sm: "calc(0.5rem - 4px)",
    md: "calc(0.5rem - 2px)",
    lg: "0.5rem",
    full: "9999px",
  },
  fonts: {
    sans: ["Inter", "Avenir", "Helvetica", "Arial", "sans-serif"],
    mono: ["JetBrains Mono", "Monaco", "Courier New", "monospace"],
  },
};

/**
 * 获取指定模式的主题配置
 */
export function getThemeConfig(mode: ThemeMode): ThemeConfig {
  if (mode === "system") {
    // This should ideally be resolved to 'light' or 'dark' before calling this,
    // but as a fallback we check system preference or default to dark
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches
        ? lightTheme
        : darkTheme;
    }
    return darkTheme;
  }
  return mode === "light" ? lightTheme : darkTheme;
}
