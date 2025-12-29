import { useContext } from "react";
import { ThemeContext, ThemeContextType } from "./ThemeProvider";

/**
 * 自定义 hook 用于访问主题
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { mode, toggleTheme, theme } = useTheme();
 *
 *   return (
 *     <button onClick={toggleTheme}>
 *       Current theme: {mode}
 *     </button>
 *   );
 * }
 * ```
 *
 * @throws {Error} 如果在 ThemeProvider 外部使用
 * @returns {ThemeContextType} 主题上下文对象
 */
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);

  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
}
