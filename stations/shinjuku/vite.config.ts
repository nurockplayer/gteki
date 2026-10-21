import { defineConfig } from "vite";

export default defineConfig({
  root: "app",
  publicDir: false,
  server: { port: 5174, strictPort: false, fs: { allow: ["../../.."] } },
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 2000 },
});
