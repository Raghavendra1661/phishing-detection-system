import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev only: forward API calls to FastAPI so no CORS setup is needed locally.
    proxy: { "/api": "http://127.0.0.1:8000", "/health": "http://127.0.0.1:8000" },
  },
  test: { environment: "jsdom", setupFiles: "./src/setupTests.js", globals: true },
});
