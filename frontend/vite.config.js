import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths so the built dist/ works whether it's served from
  // "/" (FastAPI static mount) or opened at a sub-path.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
