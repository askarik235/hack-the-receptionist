import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the backend runs on :3000; Vite forwards API and portrait requests to it,
// so the browser only ever talks to one origin (cookies just work).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
      "/portraits": "http://localhost:3000",
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
