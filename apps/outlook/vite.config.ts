import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { MANIFEST_VERSION } from "./src/setup/version";

// Deployed at https://tools.iusehalo.com/outlook/ — base path matches.
// Override with VITE_BASE=/ for local dev or alternative paths.
const BASE = process.env.VITE_BASE ?? "/outlook/";

// Emit /outlook/latest.json so the running SPA can detect when a newer
// manifest is available. Compared first-three-segments-only against the `mv`
// query param baked into the installed manifest's runtime URLs.
function emitLatestJson(): Plugin {
  return {
    name: "emit-latest-json",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "latest.json",
        source: JSON.stringify(
          { manifestVersion: MANIFEST_VERSION, released: new Date().toISOString() },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [react(), emitLatestJson()],
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        // Main task pane bundle
        taskpane: resolve(__dirname, "index.html"),
        // OAuth callback page — separate entry so it can run standalone in the Office Dialog.
        // Lives at <root>/auth/callback.html so Vite emits dist/auth/callback.html.
        callback: resolve(__dirname, "auth/callback.html"),
        // Compose-surface task pane — mounted in the mailCompose runtime declared in manifest.json.
        // Emits dist/compose/index.html, served at /outlook/compose/.
        compose: resolve(__dirname, "compose/index.html"),
        // Admin setup wizard — generates per-tenant manifest .zip for M365 upload.
        // Standalone page (no Office.js); served at /outlook/setup/.
        setup: resolve(__dirname, "setup/index.html"),
      },
    },
  },
  server: {
    port: 3000,
    host: true,
    // Outlook sideload requires HTTPS — use office-addin-dev-certs locally,
    // or tunnel via ngrok / Cloudflare. Production hosts handle TLS.
    https: (() => {
      const certsDir = `${homedir()}/.office-addin-dev-certs`;
      const key = `${certsDir}/localhost.key`;
      const cert = `${certsDir}/localhost.crt`;
      if (existsSync(key) && existsSync(cert)) {
        return { key: readFileSync(key), cert: readFileSync(cert) };
      }
      return undefined;
    })(),
    headers: {
      // Loosen for local dev only; production CORS is owned by Halo per-tenant.
      "Access-Control-Allow-Origin": "*",
    },
  },
});
