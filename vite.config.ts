import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/ddl": process.env.DDL_DEV_API_URL ?? "http://127.0.0.1:8787",
      "/api/missing-link": "http://127.0.0.1:8787",
      "/api/analytics/visit": "http://127.0.0.1:8787",
      "/api/analytics/summary": "http://127.0.0.1:8787"
    }
  }
});
