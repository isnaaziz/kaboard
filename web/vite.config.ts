import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:4411", changeOrigin: false } },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1024 },
});
