import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a Node.js global
const host = process.env.TAURI_DEV_HOST;
// Keep --force inside the canonical optimizeDeps object. Passing a partial
// inline object from the programmatic dev server replaces include/noDiscovery.
// @ts-expect-error process is a Node.js global
const forceOptimizeDeps = process.argv.includes("--force");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwind()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and external repo
      ignored: ["**/src-tauri/**", "**/beekeeper-studio/**"],
    },
  },
  optimizeDeps: {
    entries: ["index.html"],
    noDiscovery: true,
    force: forceOptimizeDeps,
    // Tauri opens the WebView as soon as Vite answers the first health check.
    // Relying only on crawl-based discovery lets Vite report "ready" and then
    // block the first workspace request while it discovers/pre-bundles these
    // dependencies. Keep the interactive workbench dependency set explicit so
    // cold development starts do the work before the WebView asks for it.
    include: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
      "zustand",
      "zustand/middleware",
      "lucide-react",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "uuid",
      "@radix-ui/react-dialog",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@glideapps/glide-data-grid",
      "@monaco-editor/react",
      "cmdk",
      "date-fns",
      "monaco-vim",
      "react-icons/si",
      "@tauri-apps/api/app",
      "@tauri-apps/api/core",
      "@tauri-apps/api/event",
      "@tauri-apps/api/window",
      "@tauri-apps/plugin-dialog",
      "@tauri-apps/plugin-opener",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-updater",
    ],
  },
  build: {
    chunkSizeWarningLimit: 650,
  },
}));
