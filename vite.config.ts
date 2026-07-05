import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

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
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/react") || id.includes("/react-dom")) {
            return "vendor-react";
          }
          if (id.includes("@monaco-editor") || id.includes("monaco-editor")) {
            return "vendor-monaco";
          }
          if (id.includes("@tauri-apps")) {
            return "vendor-tauri";
          }
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("marked")) {
            return "vendor-markdown";
          }
          if (id.includes("date-fns")) {
            return "vendor-date";
          }
          if (id.includes("lodash") || id.includes("zustand")) {
            return "vendor-state-utils";
          }
          if (id.includes("@glideapps/glide-data-grid")) {
            return "vendor-grid";
          }
          if (id.includes("@radix-ui")) {
            return "vendor-radix";
          }
          return "vendor";
        },
      },
    },
  },
}));
