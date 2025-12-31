import React, { createContext, useEffect, useState, useCallback } from "react";
import { ThemeMode, getThemeConfig, ThemeConfig } from "./theme.config";

/**
 * 主题上下文类型定义
 */
export interface ThemeContextType {
  mode: ThemeMode;
  theme: ThemeConfig;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

/**
 * 主题上下文
 */
export const ThemeContext = createContext<ThemeContextType | undefined>(
  undefined
);

/**
 * 本地存储键名
 */
const THEME_STORAGE_KEY = "oxide-studio-theme";

/**
 * 从本地存储读取主题设置
 */
function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch (error) {
    console.warn("Failed to read theme from localStorage:", error);
  }

  // Default to system
  return "system";
}

/**
 * 保存主题设置到本地存储
 */
function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch (error) {
    console.warn("Failed to save theme to localStorage:", error);
  }
}

/**
 * 应用 CSS 变量到 document
 */
function applyCSSVariables(theme: ThemeConfig, mode: ThemeMode): void {
  const root = document.documentElement;

  // 应用颜色变量
  Object.entries(theme.colors).forEach(([key, value]) => {
    const cssVarName = `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
    root.style.setProperty(cssVarName, value);
  });

  // 应用 radius 变量
  root.style.setProperty("--radius", theme.radius.lg);

  // 更新 dark class
  if (mode === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * 主题提供者组件 Props
 */
export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: ThemeMode;
}

/**
 * 主题提供者组件
 * 管理主题状态、CSS 变量注入和持久化
 */
export function ThemeProvider({ children, defaultTheme }: ThemeProviderProps) {
  // Initialize state from storage or default
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (getStoredTheme() as ThemeMode) || defaultTheme || "system";
  });

  // Calculate the effective theme (light or dark) based on mode and system preference
  const [effectiveMode, setEffectiveMode] = useState<"light" | "dark">("dark");

  const resolveSystemTheme = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "dark"; // Default fallback
  }, []);

  useEffect(() => {
    if (mode === "system") {
      setEffectiveMode(resolveSystemTheme());
    } else {
      setEffectiveMode(mode);
    }
  }, [mode, resolveSystemTheme]);

  // Listen for system preference changes when in system mode
  useEffect(() => {
    if (mode !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setEffectiveMode(e.matches ? "dark" : "light");
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } else {
      // Safari legacy
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [mode]);

  const theme = getThemeConfig(effectiveMode);

  // Apply theme variables to DOM
  useEffect(() => {
    applyCSSVariables(theme, effectiveMode);
  }, [theme, effectiveMode]);

  // Toggle theme (cycles: light -> dark -> system)
  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode =
        prev === "light" ? "dark" : prev === "dark" ? "system" : "light";
      storeTheme(next);
      return next;
    });
  }, []);

  // Set specific theme
  const setTheme = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    storeTheme(newMode);
  }, []);

  const value: ThemeContextType = {
    mode,
    theme,
    toggleTheme,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
