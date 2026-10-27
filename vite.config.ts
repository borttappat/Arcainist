import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  root: "client",
  plugins: [react()],
  // AGPL section 13: every player is offered the source. Forks point `repository` at their own.
  define: { __SOURCE_URL__: JSON.stringify(pkg.repository.url) },
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/ws": { target: "ws://localhost:8080", ws: true } },
  },
  test: { root: ".", include: ["engine/test/**/*.test.ts"] },
} as any);
